// Dry run, nothing on-chain, no keys, no wallet. Tests EVERY Ethereum Ondo token in docs/rwa-registry-1.json
// for a public DEX route with a small USDC amount, and writes docs/eth-dex-routes.json.
// Save as scripts/eth-dex-scan.mjs in the repo, then from the repo root:
//   node scripts/eth-dex-scan.mjs
// Takes a few minutes. It prints progress and a summary at the end.
import fs from "node:fs";

const USDC = { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 };
const AMOUNT_USD = 2;
const HOST = "https://api.paraswap.io";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tokens;
try {
  tokens = JSON.parse(fs.readFileSync(new URL("../docs/rwa-registry-1.json", import.meta.url), "utf8")).tokens;
} catch {
  console.error("docs/rwa-registry-1.json not found. Run scripts/rwa-quote-chain.mjs first, or tell your AI.");
  process.exit(1);
}

async function route(dest) {
  const qs = new URLSearchParams({
    srcToken: USDC.address, srcDecimals: "6", destToken: dest, destDecimals: "18",
    amount: String(AMOUNT_USD * 10 ** USDC.decimals), side: "SELL", network: "1",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${HOST}/prices?${qs}`, { signal: AbortSignal.timeout(15000) });
      if (res.status === 429) { await sleep(2500); continue; } // rate limited: wait and retry once
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.priceRoute) {
        const r = j.priceRoute;
        const src = Number(r.srcUSD), dst = Number(r.destUSD);
        const exch = (r.bestRoute?.[0]?.swaps?.[0]?.swapExchanges ?? []).map((x) => x.exchange).join(",");
        return { routable: true, out: Number(r.destAmount) / 1e18, gasUsd: Number(r.gasCostUSD), lossPct: src > 0 && dst > 0 ? +(((src - dst) / src) * 100).toFixed(2) : null, via: exch };
      }
      return { routable: false, why: `${res.status} ${String(j.error ?? j.message ?? "").slice(0, 80)}` };
    } catch (e) {
      if (attempt === 1) return { routable: false, why: e.message };
    }
  }
  return { routable: false, why: "rate limited" };
}

const out = [];
for (let i = 0; i < tokens.length; i++) {
  const t = tokens[i];
  const r = await route(t.address);
  out.push({ symbol: t.symbol, name: t.name ?? null, address: t.address, ...r });
  if ((i + 1) % 20 === 0 || i === tokens.length - 1) console.log(`${i + 1}/${tokens.length} checked`);
  await sleep(350);
}

const ok = out.filter((x) => x.routable);
const clean = ok.filter((x) => x.lossPct !== null && x.lossPct < 2);
fs.writeFileSync(new URL("../docs/eth-dex-routes.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), amountUsd: AMOUNT_USD, tokens: out }, null, 1));
console.log(`\nETHEREUM TOKENS CHECKED: ${out.length}`);
console.log(`WITH A DEX ROUTE AT $${AMOUNT_USD}: ${ok.length}`);
console.log(`ROUTE WITH LESS THAN 2% LOSS: ${clean.length}`);
console.log("EXAMPLES WITH NO ROUTE:", out.filter((x) => !x.routable).slice(0, 8).map((x) => x.symbol).join(", ") || "none");
console.log("Wrote docs/eth-dex-routes.json");
