// Signed GET helper for the Binance Web3 API. Run from the repo root:
//   node --env-file=apps/web/.env.local scripts/binance-get.mjs /api/v1/dex/aggregator/supported/chain binanceChainId=56
// Docs: https://web3.binance.com/en/dev-docs/authentication
import crypto from "node:crypto";

const API_KEY = process.env.OC_API_KEY;
const SECRET_KEY = process.env.OC_SECRET_KEY;
if (!API_KEY || !SECRET_KEY) {
  console.error("Missing OC_API_KEY / OC_SECRET_KEY. Put them in apps/web/.env.local (no NEXT_PUBLIC_ prefix).");
  process.exit(1);
}

const BASE_URL = "https://web3.binance.com/build";
const BUILD_PREFIX = "/build"; // must be part of BOTH the URL and the signed path

const [path, ...pairs] = process.argv.slice(2);
if (!path || !path.startsWith("/api/")) {
  console.error("Usage: node scripts/binance-get.mjs /api/v1/... key=value key=value");
  process.exit(1);
}

const query = pairs
  .map((p) => {
    const i = p.indexOf("=");
    return `${encodeURIComponent(p.slice(0, i))}=${encodeURIComponent(p.slice(i + 1))}`;
  })
  .join("&");
const fullPath = query ? `${path}?${query}` : path;

const timestamp = new Date().toISOString();
const preHash = timestamp + "GET" + BUILD_PREFIX + fullPath + "";
const signature = crypto.createHmac("sha256", SECRET_KEY).update(preHash, "utf8").digest("base64");

const t0 = Date.now();
const res = await fetch(BASE_URL + fullPath, {
  headers: {
    "X-OC-APIKEY": API_KEY,
    "X-OC-TIMESTAMP": timestamp,
    "X-OC-SIGN": signature,
  },
});
const text = await res.text();
console.log(`HTTP ${res.status} in ${Date.now() - t0}ms`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}