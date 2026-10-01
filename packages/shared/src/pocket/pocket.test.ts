import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Wallet } from "ethers";
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
import { createRealSwapHelper } from "./swap-adapter";
import type { GuardedSwapExecutor, Job, Pocket, PocketBalances, SwapHelper } from "./types";

const mainAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const testSigner = new Wallet(`0x${"11".repeat(32)}`);
const sessionAddress = testSigner.address;
const aaplXAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const approvalSpender = "0xcccccccccccccccccccccccccccccccccccccccc";
const testConfig: PocketConfig = {
  ...POCKET_CONFIG,
  aaplXAddress,
  approvalSpenderAddress: approvalSpender,
  aaplXDecimals: 18,
};

class TestMemoryStorage implements PocketJobStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
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
    tokenIn: POCKET_CONFIG.usdtAddress,
    tokenOut: aaplXAddress,
    amountIn: 5,
    amountUsdt: 5,
    approvalAmount: 5,
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

function testQuote(input: Parameters<SwapHelper["quote"]>[0], overrides: Record<string, unknown> = {}) {
  return {
    ...input,
    approvalSpender,
    createdAt: Date.now(),
    ...overrides,
  };
}

function testSwapHelper(
  quoteOverride: (input: Parameters<SwapHelper["quote"]>[0]) => unknown = (input) => testQuote(input),
  simulate: SwapHelper["simulate"] = async () => true,
  execute: SwapHelper["execute"] = async () => ({ hash: "test-hash" }),
): SwapHelper {
  return {
    quote: async (input) => quoteOverride(input),
    simulate,
    execute,
  };
}

function testExecutor(
  executeTrade: GuardedSwapExecutor["executeTrade"] = async () => ({ status: "executed", txHash: "test-hash" }),
  estimateGasBnb: GuardedSwapExecutor["estimateGasBnb"] = async () => 0.001,
): GuardedSwapExecutor {
  return { executeTrade, estimateGasBnb };
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
    storage, locks, balances: testBalances(), amountUsdt: 5,
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

test("sell route is allowed only for configured AAPLx to USDT with session addresses", () => {
  const sell = testGuardInput({ side: "sell", tokenIn: aaplXAddress, tokenOut: POCKET_CONFIG.usdtAddress, amountIn: 2, approvalAmount: 2 });
  assert.equal(evaluatePocketAction(sell, testConfig).allowed, true);
  assert.deepEqual(evaluatePocketAction({ ...sell, tokenIn: "0xdddddddddddddddddddddddddddddddddddddddd" }, testConfig), {
    allowed: false,
    reason: "unsupported_token_route",
  });
  assert.deepEqual(evaluatePocketAction({ ...sell, receiver: mainAddress }, testConfig), {
    allowed: false,
    reason: "receiver_must_be_session",
  });
});

test("rejects approval above notional", () => {
  assert.deepEqual(evaluatePocketAction(testGuardInput({ approvalAmount: 6 }), testConfig), {
    allowed: false,
    reason: "approval_above_notional",
  });
});

test("wrong quote spender, receiver, token, or amount is rejected before execute", async () => {
  const invalidQuotes = [
    { spender: mainAddress },
    { receiver: mainAddress },
    { tokenOut: "0xdddddddddddddddddddddddddddddddddddddddd" },
    { amountIn: 6 },
    { approvalSpender: "0xdddddddddddddddddddddddddddddddddddddddd" },
  ];
  for (const overrides of invalidQuotes) {
    let executeCalls = 0;
    const helper = testSwapHelper((input) => testQuote(input, overrides), async () => true, async () => {
      executeCalls += 1;
      return { hash: "unexpected" };
    });
    const result = await executeGuardedTrade(testGuardInput(), helper, testSigner, async () => {}, testConfig);
    assert.notEqual(result.status, "executed");
    assert.equal(executeCalls, 0);
  }
});

test("rejects quotes older than 30 seconds", async () => {
  const helper = testSwapHelper((input) => testQuote(input, { createdAt: Date.now() - 30_001 }));
  const result = await executeGuardedTrade(testGuardInput(), helper, testSigner, async () => {}, testConfig);
  assert.deepEqual(result, { status: "failed_before_execute", reason: "invalid_or_stale_quote" });
});

test("helper quote/simulate failures are pre-execute failures", async () => {
  const quoteThrows = testSwapHelper(async () => { throw new Error("quote failed"); });
  const simulateThrows = testSwapHelper(undefined, async () => { throw new Error("simulation failed"); });
  assert.equal((await executeGuardedTrade(testGuardInput(), quoteThrows, testSigner, async () => {}, testConfig)).status, "failed_before_execute");
  assert.equal((await executeGuardedTrade(testGuardInput(), simulateThrows, testSigner, async () => {}, testConfig)).status, "failed_before_execute");
});

test("execute throw or missing result retains reservation as execution unknown", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const unknownExecutor = testExecutor(async () => ({ status: "execution_unknown" }));
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: unknownExecutor, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: 5, config: testConfig,
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
  const lowGas = testExecutor(undefined, async () => 0.01);
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: lowGas, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances({ bnb: "0.001" }), amountUsdt: 5, config: testConfig,
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

test("runner releases reservation for helper failures known to precede execute", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const failedBeforeExecute = testExecutor(async () => ({ status: "failed_before_execute", reason: "quote_failed" }));
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: failedBeforeExecute, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: 5, config: testConfig,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);

  assert.equal(result.status, "failed");
  assert.equal(persisted.reservedUsdt, 0);
  assert.equal(persisted.spentUsdt, 0);
});

test("runner retains reservation when executor throws after invocation", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const throwingExecutor = testExecutor(async () => { throw new Error("connection lost after send"); });
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: throwingExecutor, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: 5, config: testConfig,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);

  assert.equal(result.status, "execution_unknown");
  assert.equal(persisted.reservedUsdt, 5);
  assert.equal(persisted.spentUsdt, 0);
});

test("missing A token/spender config rejects even when an executor is supplied", async () => {
  const storage = new TestMemoryStorage();
  const locks = new TestSerialLock();
  const job = await activeTestJob(storage, locks);
  const executor = testExecutor();
  const result = await runAgentTick({
    pocket: testPocket(), job, helper: executor, mainAddress, signer: testSigner,
    storage, locks, balances: testBalances(), amountUsdt: 5, config: POCKET_CONFIG,
  });
  const persisted = await loadPocketJob(storage, locks, sessionAddress);

  assert.deepEqual(result, { status: "rejected", reason: "not_configured" });
  assert.equal(persisted.reservedUsdt, 0);
  assert.equal(persisted.spentUsdt, 0);
});

test("real adapter is unavailable without A bindings and keeps approval exact when bound", async () => {
  assert.equal(createRealSwapHelper({ ...testConfig, aaplXAddress: null }, testSigner), null);

  let approval: { token: string; spender: string; amount: number } | null = null;
  const adapter = createRealSwapHelper(testConfig, testSigner, {
    approvalSpenderAddress: approvalSpender,
    bindHelper(_config, signer) {
      assert.equal(signer, testSigner);
      return testSwapHelper();
    },
    async approveExact(tokenAddress, spender, amount, signer) {
      assert.equal(signer, testSigner);
      approval = { token: tokenAddress, spender, amount };
    },
    async estimateGasBnb() { return 0.001; },
  });
  assert.ok(adapter);
  const result = await adapter.executeTrade(testGuardInput(), testSigner);
  assert.equal(result.status, "executed");
  assert.deepEqual(approval, { token: POCKET_CONFIG.usdtAddress, spender: approvalSpender, amount: 5 });
});