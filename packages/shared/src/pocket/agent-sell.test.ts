import assert from "node:assert/strict";
import test from "node:test";
import { runAgentTick } from "./agent-runner";
import { loadPocketJob, setPocketJobStatus, type PocketJobLock, type PocketJobStorage } from "./job-store";
import type { Quote, QuoteRequest, SwapPipeline } from "../types";
import type { Job, Pocket, PocketBalances, SessionSigner } from "./types";

// Runs without ethers: the runner only calls signer.getAddress(), so a stub signer is enough.
process.env.NEXT_PUBLIC_AGENT_LIMITS = "on";
const main = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const session = "0xcccccccccccccccccccccccccccccccccccccccc";
const signer = { getAddress: async () => session } as unknown as SessionSigner;

class Mem implements PocketJobStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const locks: PocketJobLock = { request: async (_n, task) => task() };
const pocket: Pocket = { address: session, exported: true };
const bal = (o: Partial<PocketBalances> = {}): PocketBalances => ({ usdt: "0", bnb: "1", ...o });

function pipe(calls: QuoteRequest[], over: Partial<SwapPipeline> = {}): SwapPipeline {
  return {
    quote: async (r): Promise<Quote> => { calls.push(r); return { id: "q", style: "swap", request: r, amountOut: "0.4", issuedAt: Date.now() }; },
    simulate: async () => ({ ok: true }),
    execute: async (_q, receiver) => ({ txHash: "0xsell", receiver }),
    ...over,
  };
}
async function activeJob(s: Mem): Promise<Job> {
  await loadPocketJob(s, locks, session);
  return setPocketJobStatus(s, locks, session, "active");
}
const sell = async (over: Partial<Parameters<typeof runAgentTick>[0]> & { calls?: QuoteRequest[] } = {}) => {
  const s = new Mem();
  const calls = over.calls ?? [];
  const job = await activeJob(s);
  const result = await runAgentTick({
    pocket, job, helper: pipe(calls), mainAddress: main, signer, storage: s, locks, balances: bal(),
    amountUsdt: "0.00133113", side: "sell", isMarketOpen: async () => false, ...over,
  });
  return { result, calls, s };
};

test("agent sell: AAPLB -> USDT from the session wallet, even with the US market closed, no spend cap used", async () => {
  const { result, calls, s } = await sell();
  assert.equal(result.status, "executed");
  assert.deepEqual(calls, [{ tokenIn: "AAPLB", tokenOut: "USDT", amountIn: "0.00133113", spender: "session", receiver: "session" }]);
  if (result.status === "executed") {
    assert.equal(result.record.side, "sell");
    assert.equal(result.record.amountToken, "0.00133113");
    assert.equal(result.record.amountUsdt, 0);
    assert.equal(result.record.txHash, "0xsell");
  }
  const persisted = await loadPocketJob(s, locks, session);
  assert.equal(persisted.spentUsdt, 0);
  assert.equal(persisted.reservedUsdt, 0);
});

test("agent sell: low BNB for gas skips without touching the pipeline", async () => {
  const { result, calls } = await sell({ balances: bal({ bnb: "0.0001" }) });
  assert.equal(result.status, "skipped");
  assert.equal("reason" in result && result.reason, "insufficient_bnb_for_gas");
  assert.equal(calls.length, 0);
});

test("agent sell: kill switch, bad amount, main==session and stopped agent are all refused before any swap", async () => {
  const killed = await sell({ canExecute: () => false });
  assert.deepEqual(killed.result, { status: "rejected", reason: "kill_switch_active" });
  for (const amountUsdt of ["0", "-1", "abc", "1e3"]) {
    const r = await sell({ amountUsdt });
    assert.deepEqual(r.result, { status: "rejected", reason: "invalid_trade_amount" }, amountUsdt);
    assert.equal(r.calls.length, 0);
  }
  const same = await sell({ mainAddress: session });
  assert.deepEqual(same.result, { status: "rejected", reason: "session_must_differ_from_main" });
  const s = new Mem();
  const stopped = await runAgentTick({
    pocket, job: { ...(await activeJob(s)), status: "stopped" }, helper: pipe([]), mainAddress: main, signer,
    storage: s, locks, balances: bal(), amountUsdt: "0.001", side: "sell",
  });
  assert.equal(stopped.status, "skipped");
});

test("agent sell: a failed simulation never sends, and a send that errors after broadcast is execution_unknown", async () => {
  const sim = await sell({ helper: pipe([], { simulate: async () => ({ ok: false, error: "Not enough AAPLB" }) }) });
  assert.equal(sim.result.status, "failed");
  const unknown = await sell({ helper: pipe([], { execute: async () => { throw new Error("connection lost after send"); } }) });
  assert.equal(unknown.result.status, "execution_unknown");
});

test("agent buy is unchanged: market closed still skips, default side is buy", async () => {
  const s = new Mem();
  const job = await activeJob(s);
  const r = await runAgentTick({ pocket, job, helper: pipe([]), mainAddress: main, signer, storage: s, locks, balances: bal({ usdt: "100" }), amountUsdt: "2", isMarketOpen: async () => false });
  assert.equal(r.status, "skipped");
  assert.equal("reason" in r && r.reason, "market_closed");
});
