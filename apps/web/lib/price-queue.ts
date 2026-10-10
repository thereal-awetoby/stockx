import { createApiPriceProvider, createMockPriceProvider, type PriceSnapshot } from "@stockx/shared";

/**
 * Browser-side price loader shared by Explore and Portfolio. It caches for 30 s, merges duplicate
 * requests, and runs at most 3 at a time, so a long list can never fill the browser's connection
 * slots and block page navigation.
 */
const provider = process.env.NEXT_PUBLIC_PRICE_PROVIDER === "mock" ? createMockPriceProvider() : createApiPriceProvider();
const TTL_MS = 30_000;
const MAX_PARALLEL = 3;

const cache = new Map<string, { t: number; snap: PriceSnapshot }>();
const inflight = new Map<string, Promise<PriceSnapshot>>();
const waiting: Array<() => void> = [];
let active = 0;

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export function getPriceCached(key: string): Promise<PriceSnapshot> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return Promise.resolve(hit.snap);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = withSlot(() => provider.getPrices(key))
    .then((snap) => { cache.set(key, { t: Date.now(), snap }); return snap; })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, request);
  return request;
}
