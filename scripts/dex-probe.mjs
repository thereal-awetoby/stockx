// Dry run, nothing on-chain, no keys, no wallet. Asks public DEX aggregators whether Ethereum Ondo tokens
// can be bought with small amounts of USDC WITHOUT Binance's $5 minimum.
// Save as scripts/dex-probe.mjs in the repo, then from the repo root:
//   node scripts/dex-probe.mjs
// Uses docs/rwa-registry-1.json for extra tokens if present.
import fs from "node:fs";

const USDC = { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 };
const AMOUNTS = [1, 2, 5]; // USD

let targets = [{ symbol: "AAPLon", address: "0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c" }];
try {
  const reg = JSON.parse(fs.readFileSync(new URL("../docs/rwa-registry-1.json", import.meta.url), "utf8"));
  targets = targets.concat(reg.tokens.filter((t) => t.symbol !== "AAPLon").slice(0, 4).map((t) => ({ symbol: t.symbol, address: t.address })));
} catch { /* registry file is optional */ }

// ParaSwap/Velora public price API. Both hostnames are tried because the service was renamed.
const HOSTS = ["https://api.paraswap.io", "https://api.velora.xyz"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function price(dest, usd) {
  const qs = new URLSearchParams({
    srcToken: USDC.address, srcDecimals: String(USDC.decimals), destToken: dest, destDecimals: "18",
    amount: String(usd * 10 ** USDC.decimals), side: "SELL", network: "1",
  });
  let last = "no response";
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/prices?${qs}`, { signal: AbortSignal.timeout(15000) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.priceRoute) return { ok: true, host, r: j.priceRoute };
      last = `${res.status} ${String(j.error ?? j.message ?? "").slice(0, 100)}`;
    } catch (e) {
      last = e.message;
    }
  }
  return { ok: false, why: last };
}

let any = false;
for (const t of targets) {
  for (const usd of AMOUNTS) {
    const p = await price(t.address, usd);
    if (p.ok) {
      any = true;
      const exch = (p.r.bestRoute?.[0]?.swaps?.[0]?.swapExchanges ?? []).map((x) => x.exchange).join(",");
      const out = Number(p.r.destAmount) / 1e18;
      console.log(`${t.symbol.padEnd(8)} $${usd}  OK   out=${out} gasUSD=${p.r.gasCostUSD} via=${exch} host=${p.host}`);
    } else {
      console.log(`${t.symbol.padEnd(8)} $${usd}  NO   ${p.why}`);
    }
    await sleep(500);
  }
}
console.log("\nDEX ROUTE FOUND:", any ? "yes" : "no");
