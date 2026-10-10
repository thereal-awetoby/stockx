"use client";
import { useEffect, useSyncExternalStore } from "react";

export interface Overview { icon: string | null; changePct: number | null; spark: number[] }

const cache = new Map<string, Overview | "error">();
const requested = new Set<string>();
const listeners = new Set<() => void>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const chunk = queue.splice(0, 10); // one request at a time, 10 tokens per request
    try {
      const res = await fetch(`/api/rwa/overview?tokens=${chunk.join(",")}`);
      const json = (await res.json()) as Record<string, Overview>;
      for (const s of chunk) cache.set(s, res.ok && json[s] ? json[s] : "error");
    } catch {
      for (const s of chunk) cache.set(s, "error");
    }
    emit();
  }
  flushing = false;
}

/** Asks for a token's logo, 24h change and sparkline. Requests are batched, never one-per-row. */
export function requestOverview(symbol: string): void {
  if (requested.has(symbol)) return;
  requested.add(symbol);
  queue.push(symbol);
  if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, 60);
}

export function useOverview(symbol: string, enabled = true): Overview | null {
  useEffect(() => { if (enabled) requestOverview(symbol); }, [symbol, enabled]);
  const value = useSyncExternalStore(subscribe, () => cache.get(symbol), () => undefined);
  return value && value !== "error" ? value : null;
}
