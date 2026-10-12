// Dry run, nothing on-chain. Quotes Ethereum Ondo tokens against USDC (the only allowed pay token found).
// Binance rejects orders under 5 USD, and 5 USDC is just under $5, so this asks for 6.
// Run from the repo root:
//   node --env-file=apps/web/.env.local scripts/rwa-quote-probe.mjs
// Needs OC_API_KEY / OC_SECRET_KEY in apps/web/.env.local. Uses docs/rwa-registry-1.json if present.
import crypto from "node:crypto";
import fs from "node:fs";

const KEY = process.env.OC_API_KEY;
const SECRET = process.env.OC_SECRET_KEY;
if (!KEY || !SECRET) { console.error("Missing OC_API_KEY / OC_SECRET_KEY (apps/web/.env.local)"); process.exit(1); }

const WALLET = "0x6fe5b6d32C724e2a0761C8fa49e171923D71D7ba";
const CHAIN = "1";
const BASE = "https://web3.binance.com/build";

// Candidate pay tokens on Ethereum (addresses typed from memory: check on Etherscan before relying on one).
const STABLES = [
  { name: "USDC",  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  { name: "USDT",  address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
  { name: "DAI",   address: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18 },
  { name: "PYUSD", address: "0x6c3ea9036406852006290770bedfcaba0e23a0e8", decimals: 6 },
  { name: "USDe",  address: "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", decimals: 18 },
  { name: "USDtb", address: "0xc139190f447e929f090edeb554d95abb8b18ac1c", decimals: 18 },
];

let targets = [{ symbol: "AAPLon", address: "0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c" }];
try {
  const reg = JSON.parse(fs.readFileSync(new URL("../docs/rwa-registry-1.json", import.meta.url), "utf8"));
  const more = reg.tokens.filter((t) => t.symbol !== "AAPLon").slice(0, 4).map((t) => ({ symbol: t.symbol, address: t.address }));
  targets = targets.concat(more);
} catch { /* registry file optional */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const units = (n, dec) => (BigInt(n) * 10n ** BigInt(dec)).toString();

async function quote(from, to, amount) {
  const params = { binanceChainId: CHAIN, fromTokenAddress: from, toTokenAddress: to, amount, userWalletAddress: WALLET };
  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const path = `/api/v1/dex/aggregator/quote?${qs}`;
  const ts = new Date().toISOString();
  const sig = crypto.createHmac("sha256", SECRET).update(ts + "GET" + "/build" + path, "utf8").digest("base64");
  const res = await fetch(BASE + path, { headers: { "X-OC-APIKEY": KEY, "X-OC-TIMESTAMP": ts, "X-OC-SIGN": sig } });
  return res.json();
}

const works = new Set();
const AMOUNT = 6;
for (const t of targets) {
  for (const s of STABLES.filter((x) => x.name === "USDC")) {
    let line;
    try {
      const j = await quote(s.address, t.address, units(AMOUNT, s.decimals));
      if (j.code === 0 && j.data?.[0]) {
        const q = j.data[0];
        works.add(s.name);
        const route = (q.dexRouterList || []).map((r) => r.dexProtocol?.dexName).join(">");
        line = `OK   mode=${q.executionMode} out=${q.toTokenAmount} (dec ${q.toToken?.decimal}) impact=${q.priceImpactPercent}% honeypot=${q.toToken?.isHoneyPot} tax=${q.toToken?.taxRate} gas=${q.estimateGasFee} route=${route} spender=${q.approveTarget}`;
      } else {
        line = `ERR  ${j.code} ${String(j.msg).slice(0, 110)}`;
      }
    } catch (e) {
      line = `ERR  ${e.message}`;
    }
    console.log(`${s.name.padEnd(5)} -> ${t.symbol.padEnd(8)} ${line}`);
    await sleep(400);
  }
}
console.log("\nUSDC QUOTES OK:", works.size ? "yes" : "no");
