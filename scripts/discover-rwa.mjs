// Finds every bStock / Ondo token on BNB Chain that the Binance RWA API lists, then dry-runs a
// 1 USDT quote for each. Sends NOTHING on-chain. Writes docs/rwa-registry.json.
//
//   node --env-file=apps/web/.env.local scripts/discover-rwa.mjs
//   node --env-file=apps/web/.env.local scripts/discover-rwa.mjs PLTR SOFI   (extra tickers/keywords)
//
// It is rate limited (one request per ~800 ms). A full run takes a few minutes.
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

const found = new Map(); // address -> token row
for (const [i, kw] of keywords.entries()) {
  const data = await get("/api/v1/dex/market/rwa/search", { keyword: kw, binanceChainId: "56" });
  if (data?.__error) console.error(`search ${kw}: ${data.__error}`);
  else {
    for (const row of data ?? []) {
      for (const a of row.assets ?? []) {
        if (a.binanceChainId !== "56" || !/^0x[0-9a-f]{40}$/i.test(a.tokenContractAddress ?? "")) continue;
        if (!["bstock", "ondo"].includes(a.platformId)) continue;
        const address = a.tokenContractAddress.toLowerCase();
        if (!found.has(address)) {
          found.set(address, { ticker: row.ticker, company: row.companyName ?? null, symbol: a.tokenSymbol, platform: a.platformId, assetType: a.assetType ?? null, address });
        }
      }
    }
  }
  process.stdout.write(`\rsearched ${i + 1}/${keywords.length}  tokens found: ${found.size}   `);
  await sleep(DELAY_MS);
}
console.log(`\nQuoting ${found.size} tokens (1 USDT each, nothing is sent)...`);

const rows = [];
let n = 0;
for (const token of found.values()) {
  n++;
  const data = await get("/api/v1/dex/aggregator/quote", {
    binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: token.address, amount: "1000000000000000000", userWalletAddress: WALLET,
  });
  const best = Array.isArray(data) ? (data.find((q) => q.isBest) ?? data[0]) : null;
  const row = { ...token, quote: null };
  if (best) {
    row.quote = {
      executionMode: best.executionMode,
      decimals: best.toToken?.decimal ?? null,
      symbolFromQuote: best.toToken?.tokenSymbol ?? null,
      amountOutPerUsdt: best.toTokenAmount,
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
  console.log(`${String(n).padStart(3)}/${found.size} ${token.symbol.padEnd(10)} ${token.platform.padEnd(7)} ${tag}`);
  await sleep(DELAY_MS);
}

mkdirSync("docs", { recursive: true });
writeFileSync("docs/rwa-registry.json", JSON.stringify({ generatedAt: new Date().toISOString(), chain: 56, quoteAmountUsdt: 1, tokens: rows }, null, 2));
const ok = rows.filter((r) => r.quote);
console.log(`\nDone. ${ok.length}/${rows.length} quotable. bStocks: ${ok.filter((r) => r.platform === "bstock").length}, Ondo: ${ok.filter((r) => r.platform === "ondo").length}. Saved docs/rwa-registry.json`);
