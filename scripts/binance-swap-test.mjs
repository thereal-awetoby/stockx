// Read-only dry run: quote -> swap (builds tx data, sends NOTHING).
// From the repo root:
//   node --env-file=apps/web/.env.local scripts/binance-swap-test.mjs 0xYOUR_WALLET 5
import crypto from "node:crypto";
import { parseUnits, isAddress } from "viem";

const API_KEY = process.env.OC_API_KEY;
const SECRET_KEY = process.env.OC_SECRET_KEY;
const [wallet, usdt = "5"] = process.argv.slice(2);
if (!API_KEY || !SECRET_KEY) { console.error("Missing OC_API_KEY / OC_SECRET_KEY in apps/web/.env.local"); process.exit(1); }
if (!wallet || !isAddress(wallet)) { console.error("Usage: node scripts/binance-swap-test.mjs 0xYourWalletAddress 5"); process.exit(1); }

const BASE_URL = "https://web3.binance.com/build";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const AAPLB = "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a";

async function get(path, params) {
  const query = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const fullPath = `${path}?${query}`;
  const ts = new Date().toISOString();
  const sig = crypto.createHmac("sha256", SECRET_KEY).update(ts + "GET" + "/build" + fullPath, "utf8").digest("base64");
  const t0 = Date.now();
  const res = await fetch(BASE_URL + fullPath, { headers: { "X-OC-APIKEY": API_KEY, "X-OC-TIMESTAMP": ts, "X-OC-SIGN": sig } });
  const json = await res.json();
  console.log(`\n== ${path}  HTTP ${res.status} in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(json, null, 2));
  return json;
}

const amount = parseUnits(usdt, 18).toString();
const quote = await get("/api/v1/dex/aggregator/quote", {
  binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: AAPLB, amount, userWalletAddress: wallet,
});
const best = quote?.data?.find?.((q) => q.isBest) ?? quote?.data?.[0];
if (!best) { console.error("\nNo quote returned, stopping."); process.exit(1); }
console.log(`\nquoteId=${best.quoteId} mode=${best.executionMode} out=${best.toTokenAmount}`);

await get("/api/v1/dex/aggregator/swap", {
  binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: AAPLB, amount,
  userWalletAddress: wallet, slippage: "0.5", quoteId: best.quoteId,
});