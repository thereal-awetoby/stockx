// SERVER ONLY (route handlers). These Binance Web3 endpoints are public: no key, no signature.
// Paths come from Binance's published "tokenized securities info" skill. Addresses always come from our registry.
const HOST = "https://www.binance.com/bapi/defi";

export const PUBLIC_PATHS = {
  kline: "/v1/public/wallet-direct/buw/wallet/dex/market/token/kline/ai",
  meta: "/v1/public/wallet-direct/buw/wallet/market/token/rwa/meta/ai",
  dynamic: "/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai",
} as const;

export async function binancePublic<T = unknown>(path: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${HOST}${path}?${qs}`, {
    headers: { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as { code?: string; data?: T } | null;
  if (!json || json.code !== "000000") throw new Error(`Binance public API error (HTTP ${res.status})`);
  return json.data as T;
}
