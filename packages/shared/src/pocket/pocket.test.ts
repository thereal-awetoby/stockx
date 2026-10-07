import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Wallet } from "ethers";
import { SwapError, QuoteExpiredError } from "../errors";
import { createMockProvider } from "../mock-provider";
import { createSwapHelper } from "../swap";
import type { Quote, QuoteRequest, SwapPipeline } from "../types";
import { POCKET_CONFIG, type PocketConfig } from "./config";
import { evaluatePocketAction, executeGuardedTrade, type PocketGuardInput } from "./guards";
import {
  commitPocketJobSpend,
  loadPocketJob,
  releasePocketJobSpend,
  reservePocketJobSpend,
  setPocketJobStatus,
  type PocketJobLock,
  type PocketJobStorage,
} from "./job-store";
import { fundPocket } from "./wallet";
import { runAgentTick } from "./agent-runner";
import type { Job, Pocket, PocketBalances } from "./types";

const mainAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const testSigner = new Wallet(`0x${"11".repeat(32)}`);
const sessionAddress = testSigner.address;
const aaplbAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const testConfig: PocketConfig = {
  ...POCKET_CONFIG,
  aaplbAddress,
  aaplbDecimals: 18,
};

class TestMemoryStorage implements PocketJobStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

class TestSerialLock implements PocketJobLock {
  private readonly queues = new Map<string, Promise<unknown>>();
  async request<T>(name: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveQueue) => { release = resolveQueue; });
    this.queues.set(name, previous.then(() => current));
    await previous;
    try { return await task(); } finally { release(); }
  }
}

function testGuardInput(overrides: Partial<PocketGuardInput> = {}): PocketGuardInput {
  return {
    mainAddress,
    sessionAddress,
    spender: sessionAddress,
    receiver: sessionAddress,
    job: testJob(),
    side: "buy",
    tokenIn: "USDT",
    tokenOut: "AAPLB",
    amountIn: "5",
    amountUsdt: 5,
    sessionConfigured: true,
    capUsdt: 25,
    spentUsdt: 0,
    reservedUsdt: 0,
    ...overrides,
  };
}

function testJob(overrides: Partial<Job> = {}): Job {
  return { id: "test-job", capUsdt: 25, spentUsdt: 0, reservedUsdt: 0, lastRunDay: null, status: "active", ...overrides };
}

function testPocket(overrides: Partial<Pocket> = {}): Pocket {
  return { address: sessionAddress, exported: true, ...overrides };
}

function testBalances(overrides: Partial<PocketBalances> = {}): PocketBalances {
  return { usdt: "100", bnb: "1", ...overrides };
}

function testQuote(input: QuoteRequest, overrides: Partial<Quote> = {}): Quote {
  return {
    id: "test-quote",
    style: "swap",
    request: input,
    amountOut: "0.02",
    issuedAt: Date.now(),
    ...overrides,
  };
}

function testPipeline(overrides: Partial<SwapPipeline> = {}): SwapPipeline {
  return {
    quote: async (input) => testQuote(input),
    simulate: async () => ({ ok: true }),
    execute: async (_quote, receiver) => ({ txHash: "test-hash", receiver }),
    ...overrides,
  };
}

async function activeTestJob(storage: TestMemoryStorage, locks: TestSerialLock): Promise<Job> {
  await loadPocketJob(storage, locks, sessionAddress);
  return setPocketJobStatus(storage, locks, sessionAddress, "active");
}

test("unconfigured helper is rejected without reserving or spending", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: null, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: "5",
    config: testConfig,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);

  assert.deepEqual(result, { status: "rejected", reason: "not_configured" });
  assert.equal(persisted.spentUsdt, 0);
  assert.equal(persisted.reservedUsdt, 0);
});

test("guard rejects main=session and malformed addresses", () => {
  assert.deepEqual(evaluatePocketAction(testGuardInput({ mainAddress: sessionAddress }), testConfig), {
    allowed: false,
    reason: "session_must_differ_from_main",
  });
  assert.deepEqual(evaluatePocketAction(testGuardInput({ mainAddress: "bad" }), testConfig), {
    allowed: false,
    reason: "invalid_address",
  });
});

test("sell route is allowed only for AAPLB to USDT with session addresses", () => {
  const sell = testGuardInput({ side: "sell", tokenIn: "AAPLB", tokenOut: "USDT", amountIn: "2", amountUsdt: 2 });
  assert.equal(evaluatePocketAction(sell, testConfig).allowed, true);
  assert.deepEqual(evaluatePocketAction({ ...sell, tokenOut: "AAPLB" }, testConfig), {
    allowed: false,
    reason: "unsupported_token_route",
  });
  assert.deepEqual(evaluatePocketAction({ ...sell, receiver: mainAddress }, testConfig), {
    allowed: false,
    reason: "receiver_must_be_session",
  });
});

test("rejects trades above the per-trade risk limit", () => {
  assert.deepEqual(evaluatePocketAction(testGuardInput({ amountIn: "6", amountUsdt: 6 }), testConfig), {
    allowed: false,
    reason: "max_trade_exceeded",
  });
});

test("wrong quote spender, receiver, token, or amount is rejected before execute", async () => {
  const invalidQuotes = [
    { spender: "main" },
    { receiver: "main" },
    { tokenOut: "UNKNOWN" },
    { amountIn: "6" },
  ];
  for (const overrides of invalidQuotes) {
    let executeCalls = 0;
    const helper = testPipeline({
      quote: async (input) => testQuote(input, { request: { ...input, ...overrides } }),
      execute: async (_quote, receiver) => {
        executeCalls += 1;
        return { txHash: "unexpected", receiver };
      },
    });
    const result = await executeGuardedTrade(testGuardInput(), helper, testSigner, testConfig);
    assert.notEqual(result.status, "executed");
    assert.equal(executeCalls, 0);
  }
});

test("gets a fresh quote after QUOTE_EXPIRED", async () => {
  let quoteCalls = 0;
  let executeCalls = 0;
  const helper = testPipeline({
    quote: async (input) => { quoteCalls += 1; return testQuote(input); },
    simulate: async () => {
      if (quoteCalls === 1) throw new QuoteExpiredError();
      return { ok: true };
    },
    execute: async (_quote, receiver) => { executeCalls += 1; return { txHash: "test-hash", receiver }; },
  });
  const result = await executeGuardedTrade(testGuardInput(), helper, testSigner, testConfig);
  assert.deepEqual(result, { status: "executed", txHash: "test-hash" });
  assert.equal(quoteCalls, 2);
  assert.equal(executeCalls, 1);
});

test("kill switch blocks execution after successful simulation", async () => {
  let executeCalls = 0;
  const pipeline = testPipeline({
    execute: async (_quote, receiver) => { executeCalls += 1; return { txHash: "test-hash", receiver }; },
  });
  const result = await executeGuardedTrade(testGuardInput(), pipeline, testSigner, testConfig, () => false);
  assert.deepEqual(result, { status: "rejected", reason: "kill_switch_active" });
  assert.equal(executeCalls, 0);
});

test("helper quote/simulate failures are pre-execute failures", async () => {
  const quoteThrows = testPipeline({ quote: async () => { throw new Error("quote failed"); } });
  const simulateThrows = testPipeline({ simulate: async () => { throw new Error("simulation failed"); } });
  assert.equal((await executeGuardedTrade(testGuardInput(), quoteThrows, testSigner, testConfig)).status, "failed_before_execute");
  assert.equal((await executeGuardedTrade(testGuardInput(), simulateThrows, testSigner, testConfig)).status, "failed_before_execute");
});

test("execute throw or missing result retains reservation as execution unknown", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const unknownPipeline = testPipeline({ execute: async () => { throw new Error("connection lost after send"); } });
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: unknownPipeline, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: "5", config: testConfig,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);
  assert.equal(result.status, "execution_unknown");
  assert.equal(persisted.reservedUsdt, 5);
  assert.equal(persisted.spentUsdt, 0);
});

test("pre-execute helper failure and low BNB release the reservation", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: testPipeline(), mainAddress, signer: testSigner,
    storage, locks, balances: testBalances({ bnb: "0.001" }), amountUsdt: "5", config: testConfig,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);
  assert.deepEqual(result, { status: "skipped", reason: "insufficient_bnb_for_gas", job: persisted });
  assert.equal(persisted.reservedUsdt, 0);
});

test("job spend persists, commits success, and release leaves spend unchanged", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const active = await activeTestJob(storage, locks);
  const reservation = await reservePocketJobSpend(storage, locks, sessionAddress, 5, 10, "2026-10-01");
  assert.equal(reservation.status, "reserved");
  if (reservation.status !== "reserved") return;
  const committed = await commitPocketJobSpend(storage, locks, sessionAddress, reservation);
  assert.equal(committed.spentUsdt, 5);
  assert.equal((await loadPocketJob(storage, locks, sessionAddress)).id, active.id);
  const secondReservation = await reservePocketJobSpend(storage, locks, sessionAddress, 5, 10, "2026-10-02");
  assert.equal(secondReservation.status, "reserved");
  if (secondReservation.status === "reserved") {
    const released = await releasePocketJobSpend(storage, locks, sessionAddress, secondReservation);
    assert.equal(released.spentUsdt, 5);
  }
});

test("hook and runner do not import wallet-connect modules", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const hook = readFileSync(resolve(root, "apps/web/features/pocket/usePocket.ts"), "utf8");
  const runner = readFileSync(resolve(root, "packages/shared/src/pocket/agent-runner.ts"), "utf8");
  assert.doesNotMatch(hook, /connectMainWallet|wallet-connect|useAccount/);
  assert.doesNotMatch(runner, /connectMainWallet|wallet-connect|useAccount/);
});

test("fund transfer rejects unless the pocket backup was verified", async () => {
  const storage = new TestMemoryStorage();
  await assert.rejects(fundPocket(testSigner, sessionAddress, 5, storage), /Verify the pocket key backup/);
});

test("fund transfer is limited to the system pocket cap", async () => {
  const storage = new TestMemoryStorage();
  await assert.rejects(fundPocket(testSigner, sessionAddress, 26, storage), /system limit/);
});

test("runner releases reservation for helper failures known to precede execute", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const failedBeforeExecute = testPipeline({
    quote: async () => { throw new SwapError("TEST_QUOTE_FAILURE", "quote_failed"); },
  });
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: failedBeforeExecute, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: "5", config: testConfig,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.errorCode, "TEST_QUOTE_FAILURE");
  assert.equal(persisted.reservedUsdt, 0);
  assert.equal(persisted.spentUsdt, 0);
});

test("runner retains reservation when pipeline throws after invocation", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const throwingPipeline = testPipeline({ execute: async () => { throw new Error("connection lost after send"); } });
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: throwingPipeline, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: "5", config: testConfig,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);

  assert.equal(result.status, "execution_unknown");
  assert.equal(persisted.reservedUsdt, 5);
  assert.equal(persisted.spentUsdt, 0);
});

test("mock pipeline executes an agent trade before A2 address bindings", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const pipeline = createSwapHelper(createMockProvider(), { actor: "agent" });
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: pipeline, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: "5", config: POCKET_CONFIG,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);

  assert.equal(result.status, "executed");
  if (result.status === "executed") assert.match(result.record.txHash, /^0xmock/);
  assert.equal(persisted.spentUsdt, 5);
  assert.equal(persisted.reservedUsdt, 0);
});