// Quotes every token that scripts/rwa-chains.mjs found on ONE chain (default Ethereum, id 1): a dry-run
// quote of 5 USDT into each token. Sends NOTHING on-chain. Needs docs/rwa-chains.json from rwa-chains.mjs.
//
//   node --env-file=apps/web/.env.local scripts/rwa-quote-chain.mjs          (Ethereum)
//   node --env-file=apps/web/.env.local scripts/rwa-quote-chain.mjs 56       (BNB Chain)
//
// Writes docs/rwa-registry-<chain>.json. Rate limited (one request per ~800 ms), about 3 minutes.
import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const API_KEY = process.env.OC_API_KEY;
const SECRET_KEY = process.env.OC_SECRET_KEY;
if (!API_KEY || !SECRET_KEY) {
  console.error("Missing OC_API_KEY / OC_SECRET_KEY in apps/web/.env.local");
  process.exit(1);
}
const BASE_URL = "https://web3.binance.com/build";
const CHAIN = process.argv[2] ?? "1";
// USDT on each chain: address and decimals (they differ: BNB Chain USDT has 18 decimals, Ethereum USDT has 6).
const USDT_BY_CHAIN = {
  "1": { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
  "56": { address: "0x55d398326f99059ff775485246999027b3197955", decimals: 18 },
};
const USDT = USDT_BY_CHAIN[CHAIN];
if (!USDT) { console.error(`No USDT configured for chain ${CHAIN}. Known: ${Object.keys(USDT_BY_CHAIN).join(", ")}`); process.exit(1); }
const QUOTE_USDT = 5;
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


let tokens;
try { tokens = JSON.parse(readFileSync("docs/rwa-chains.json", "utf8")).tokens.filter((t) => t.chain === CHAIN); }
catch { console.error("Missing docs/rwa-chains.json. Run scripts/rwa-chains.mjs first."); process.exit(1); }
console.log(`Quoting ${tokens.length} tokens on chain ${CHAIN} (${QUOTE_USDT} USDT each, nothing is sent)...`);

const rows = [];
let n = 0;
for (const token of tokens) {
  n++;
  const data = await get("/api/v1/dex/aggregator/quote", {
    binanceChainId: CHAIN, fromTokenAddress: USDT.address, toTokenAddress: token.address,
    amount: (BigInt(QUOTE_USDT) * 10n ** BigInt(USDT.decimals)).toString(), userWalletAddress: WALLET,
  });
  const best = Array.isArray(data) ? (data.find((q) => q.isBest) ?? data[0]) : null;
  const row = { ...token, quote: null };
  if (best) {
    row.quote = {
      executionMode: best.executionMode,
      decimals: best.toToken?.decimal ?? null,
      symbolFromQuote: best.toToken?.tokenSymbol ?? null,
      amountOut: best.toTokenAmount,
      priceUsd: best.toToken?.tokenUnitPrice ?? null,
      priceImpactPercent: best.priceImpactPercent,
      approveTarget: best.approveTarget,
      hops: (best.dexRouterList ?? []).length,
      venues: (best.dexRouterList ?? []).map((r) => r.dexProtocol?.dexName ?? "?"),
      honeyPot: best.toToken?.isHoneyPot ?? null,
      taxRate: best.toToken?.taxRate ?? null,
    };
  } else {
    row.quoteError = data?.__error ?? "no route";
  }
  rows.push(row);
  const tag = best ? `${best.executionMode} impact ${Number(best.priceImpactPercent).toFixed(3)}% hops ${(best.dexRouterList ?? []).length}` : `NO QUOTE (${row.quoteError})`;
  console.log(`${String(n).padStart(3)}/${tokens.length} ${String(token.symbol).padEnd(10)} ${String(token.platform).padEnd(7)} ${tag}`);
  await sleep(DELAY_MS);
}

mkdirSync("docs", { recursive: true });
writeFileSync(`docs/rwa-registry-${CHAIN}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), chain: CHAIN, quoteAmountUsdt: QUOTE_USDT, tokens: rows }, null, 2));
const ok = rows.filter((r) => r.quote);
const clean = ok.filter((r) => Number(r.quote.priceImpactPercent) < 1 && !r.quote.honeyPot && !Number(r.quote.taxRate ?? 0));
const modes = {};
for (const r of ok) modes[r.quote.executionMode] = (modes[r.quote.executionMode] ?? 0) + 1;
console.log(`\nDone. ${ok.length}/${rows.length} quotable, ${clean.length} with price impact under 1% and no tax or honeypot flag.`);
console.log(`Execution modes: ${JSON.stringify(modes)}`);
console.log(`Saved docs/rwa-registry-${CHAIN}.json`);
