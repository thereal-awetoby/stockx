// Which chains does Binance list tokenized stocks on, and on which platforms? One search per keyword,
// then a tally by chain and platform. NO quotes and NOTHING is sent on-chain. Writes docs/rwa-chains.json.
//
//   node --env-file=apps/web/.env.local scripts/rwa-chains.mjs
//   node --env-file=apps/web/.env.local scripts/rwa-chains.mjs PLTR SOFI   (extra tickers/keywords)
//
// Rate limited (one request per ~800 ms). A full run takes about two minutes.
import crypto from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const API_KEY = process.env.OC_API_KEY;
const SECRET_KEY = process.env.OC_SECRET_KEY;
if (!API_KEY || !SECRET_KEY) {
  console.error("Missing OC_API_KEY / OC_SECRET_KEY in apps/web/.env.local");
  process.exit(1);
}
const BASE_URL = "https://web3.binance.com/build";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const WALLET = process.env.PROBE_WALLET ?? "0x6fe5b6d32C724e2a0761C8fa49e171923D71D7ba"; // public address, used for quoting only
const DELAY_MS = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params) {
  const query = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const fullPath = `${path}?${query}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ts = new Date().toISOString();
    const sig = crypto.createHmac("sha256", SECRET_KEY).update(ts + "GET/build" + fullPath, "utf8").digest("base64");
    try {
      const res = await fetch(BASE_URL + fullPath, { headers: { "X-OC-APIKEY": API_KEY, "X-OC-TIMESTAMP": ts, "X-OC-SIGN": sig }, signal: AbortSignal.timeout(15000) });
      const json = await res.json().catch(() => null);
      if (json?.code === 0) return json.data;
      if (json?.code === 40103 && attempt === 0) continue; // timestamp skew: retry once
      return { __error: json?.msg ?? `HTTP ${res.status}` };
    } catch (e) {
      if (attempt === 1) return { __error: String(e) };
    }
  }
  return { __error: "failed" };
}

const SEED = `AAPL MSFT NVDA GOOGL GOOG AMZN META TSLA NFLX AMD INTC AVGO QCOM TXN MU ORCL CRM ADBE CSCO IBM PLTR SNOW UBER ABNB SHOP SQ PYPL
COIN MSTR HOOD SOFI JPM BAC GS MS WFC V MA BRK KO PEP MCD NKE DIS SBUX WMT COST TGT HD LOW XOM CVX PFE JNJ MRK LLY UNH ABBV
BA CAT GE F GM LMT RTX T VZ TMUS SPY QQQ IWM DIA VOO VTI TQQQ SQQQ GLD SLV TLT ARKK XLF XLK XLE SMCI ARM TSM ASML BABA NIO RIVN LCID
MARA RIOT CRWD PANW NOW DDOG NET ZM ROKU SPOT SNAP PINS RBLX DKNG GME AMC BYND`.split(/\s+/);
const keywords = [...new Set([...SEED, ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), ...process.argv.slice(2).map((s) => s.toUpperCase())])];
const CHAIN_NAMES = { "1": "Ethereum", "56": "BNB Chain", "8453": "Base", "42161": "Arbitrum", "10": "Optimism", "137": "Polygon", "59144": "Linea", "501": "Solana", "143": "Monad", "9745": "Plasma" };

const seen = new Map(); // `${chain}|${address}` -> row
for (const [i, kw] of keywords.entries()) {
  const data = await get("/api/v1/dex/market/rwa/search", { keyword: kw, binanceChainId: "56" });
  if (data?.__error) console.error(`\nsearch ${kw}: ${data.__error}`);
  else {
    for (const row of data ?? []) {
      for (const a of row.assets ?? []) {
        const chain = String(a.binanceChainId ?? "?");
        const key = `${chain}|${String(a.tokenContractAddress ?? "").toLowerCase()}`;
        if (!seen.has(key)) seen.set(key, { chain, ticker: row.ticker, company: row.companyName ?? null, symbol: a.tokenSymbol, platform: a.platformId, assetType: a.assetType ?? null, address: a.tokenContractAddress });
      }
    }
  }
  process.stdout.write(`\rsearched ${i + 1}/${keywords.length}  token entries: ${seen.size}   `);
  await sleep(DELAY_MS);
}

const rows = [...seen.values()];
const tally = {};
for (const r of rows) {
  const k = `${r.chain} ${CHAIN_NAMES[r.chain] ?? ""}`.trim();
  tally[k] ??= {};
  tally[k][r.platform] = (tally[k][r.platform] ?? 0) + 1;
}
console.log("\n\nTokens per chain and platform:");
for (const [chain, platforms] of Object.entries(tally)) console.log(`  ${chain.padEnd(18)} ${Object.entries(platforms).map(([p, n]) => `${p}: ${n}`).join(", ")}`);

const byTicker = new Map();
for (const r of rows) {
  if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, new Set());
  byTicker.get(r.ticker).add(`${CHAIN_NAMES[r.chain] ?? r.chain}`);
}
const multi = [...byTicker.entries()].filter(([, c]) => c.size > 1);
console.log(`\nCompanies on more than one chain: ${multi.length} of ${byTicker.size}`);
for (const [t, c] of multi.slice(0, 25)) console.log(`  ${t.padEnd(8)} ${[...c].join(", ")}`);

mkdirSync("docs", { recursive: true });
writeFileSync("docs/rwa-chains.json", JSON.stringify({ generatedAt: new Date().toISOString(), tally, tokens: rows }, null, 2));
console.log("\nSaved docs/rwa-chains.json");
