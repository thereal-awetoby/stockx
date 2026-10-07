// SERVER ONLY. Never import this from a "use client" file: it reads the secret key.
import crypto from "node:crypto";

const BASE_URL = "https://web3.binance.com/build";
const BUILD_PREFIX = "/build"; // part of the URL AND of the signed path

export class BinanceError extends Error {
  constructor(public code: number | string, message: string, public status = 502) {
    super(message);
    this.name = "BinanceError";
  }
}

/** Signed GET. Retries once with a fresh timestamp on 40103 (timestamp outside recv_window). */
export async function binanceGet<T = unknown>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.OC_API_KEY;
  const secret = process.env.OC_SECRET_KEY;
  if (!key || !secret) throw new BinanceError("NO_KEYS", "OC_API_KEY / OC_SECRET_KEY are not set on the server", 500);

  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const fullPath = query ? `${path}?${query}` : path;

  for (let attempt = 0; attempt < 2; attempt++) {
    const timestamp = new Date().toISOString(); // taken right before sending
    const signature = crypto
      .createHmac("sha256", secret)
      .update(timestamp + "GET" + BUILD_PREFIX + fullPath, "utf8")
      .digest("base64");

    let res: Response;
    try {
      res = await fetch(BASE_URL + fullPath, {
        headers: { "X-OC-APIKEY": key, "X-OC-TIMESTAMP": timestamp, "X-OC-SIGN": signature },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      if (attempt === 0) continue;
      throw new BinanceError("NETWORK", "Could not reach the Binance Web3 API");
    }

    const json = (await res.json().catch(() => null)) as { code?: number | string; msg?: string; data?: T } | null;
    if (json?.code === 40103 && attempt === 0) continue;
    if (!json || json.code !== 0) throw new BinanceError(json?.code ?? res.status, json?.msg || `HTTP ${res.status}`);
    return json.data as T;
  }
  throw new BinanceError("RETRY", "Binance request failed after retry");
}

export function errorResponse(e: unknown): Response {
  if (e instanceof BinanceError) {
    return Response.json({ error: e.message, code: e.code }, { status: e.status });
  }
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}