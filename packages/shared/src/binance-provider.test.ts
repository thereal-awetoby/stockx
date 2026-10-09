import assert from "node:assert/strict";
import test from "node:test";
import { createBinanceProvider, type BuildFn, type TxRequest, type WalletExecutor } from "./binance-provider";
import { createSwapHelper } from "./swap";
import {
  assertSafeSwapTx,
  decodeApprove,
  encodeApprove,
  extractSwapTx,
  formatUnitsStr,
  minAmountOutFor,
  parseUnitsStr,
  type BuiltSwap,
} from "./swap-build";
import { TOKENS } from "./tokens";
import type { QuoteRequest } from "./types";

const USER = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";
const APPROVE_TARGET = "0x3333333333333333333333333333333333333333";
const E18 = 10n ** 18n;

const buy: QuoteRequest = { tokenIn: "USDT", tokenOut: "AAPLB", amountIn: "5", spender: "main", receiver: "main" };

function built(over: Partial<BuiltSwap> = {}): BuiltSwap {
  return {
    side: "buy",
    tokenIn: "USDT",
    tokenOut: "AAPLB",
    amountIn: (5n * E18).toString(),
    amountOut: (E18 / 50n).toString(), // 0.02 AAPLB
    minAmountOut: minAmountOutFor(E18 / 50n, 50).toString(),
    slippageBps: 50,
    executionMode: "SWAP",
    approveTarget: APPROVE_TARGET,
    priceImpactPercent: "0.01",
    route: ["Pancakeswap V3"],
    quoteId: "q1",
    gasEstimate: "250000",
    builtAt: 0,
    tx: { to: ROUTER, data: "0x12345678abcdef", value: "0" },
    ...over,
  };
}

interface Fake {
  exec: WalletExecutor;
  sent: TxRequest[];
  state: { chain: number; balance: bigint; allowance: bigint; receipt: "success" | "reverted" | "throw"; dryRunFails: boolean };
}

function fake(over: Partial<Fake["state"]> = {}): Fake {
  const sent: TxRequest[] = [];
  const state = { chain: 56, balance: 100n * E18, allowance: 0n, receipt: "success" as const, dryRunFails: false, ...over } as Fake["state"];
  const exec: WalletExecutor = {
    address: USER,
    chainId: async () => state.chain,
    tokenBalance: async () => state.balance,
    allowance: async () => state.allowance,
    dryRun: async () => {
      if (state.dryRunFails) throw new Error("execution reverted");
      return 210_000n;
    },
    send: async (tx) => {
      sent.push(tx);
      // an approval, once mined, sets the allowance
      const a = decodeApprove(tx.data);
      if (a) state.allowance = a.amount;
      return "0x" + String(sent.length).padStart(64, "0");
    },
    waitForReceipt: async () => {
      if (state.receipt === "throw") throw new Error("timeout");
      return { status: state.receipt };
    },
  };
  return { exec, sent, state };
}

const helperFor = (f: Fake, b: BuildFn, wallet: "main" | "session" = "main", actor: "user" | "agent" = "user") =>
  createSwapHelper(createBinanceProvider({ executor: f.exec, wallet, build: b }), { actor });

// ---------- pure helpers ----------

test("units round-trip without floats", () => {
  assert.equal(parseUnitsStr("5", 18), 5n * E18);
  assert.equal(parseUnitsStr("0.000001", 18), 10n ** 12n);
  assert.equal(formatUnitsStr(parseUnitsStr("12.5", 18), 18), "12.5");
  assert.equal(formatUnitsStr(0n, 18), "0");
  assert.throws(() => parseUnitsStr("1.5", 0), { code: "BAD_AMOUNT" });
  assert.throws(() => parseUnitsStr("-1", 18), { code: "BAD_AMOUNT" });
});

test("approve calldata matches the known ERC-20 encoding", () => {
  const data = encodeApprove(APPROVE_TARGET, 5n * E18);
  assert.equal(
    data,
    "0x095ea7b3" + "0".repeat(24) + "3".repeat(40) + (5n * E18).toString(16).padStart(64, "0"),
  );
  assert.deepEqual(decodeApprove(data), { spender: APPROVE_TARGET, amount: 5n * E18 });
  assert.throws(() => encodeApprove(APPROVE_TARGET, 2n ** 256n - 1n), { code: "BAD_APPROVAL_AMOUNT" });
  assert.throws(() => encodeApprove(APPROVE_TARGET, 0n), { code: "BAD_APPROVAL_AMOUNT" });
  assert.throws(() => encodeApprove("0xnope", 1n), { code: "BAD_SPENDER" });
});

test("minAmountOut applies slippage in integer math", () => {
  assert.equal(minAmountOutFor(10_000n, 50), 9_950n);
  assert.throws(() => minAmountOutFor(1n, 5000), { code: "BAD_SLIPPAGE" });
});

test("extractSwapTx finds the tx in the known shapes and fails closed otherwise", () => {
  const tx = { to: ROUTER, data: "0xabcdef01", value: "0", gas: "300000" };
  assert.equal(extractSwapTx([{ tx }]).to, ROUTER);
  assert.equal(extractSwapTx({ tx }).gas, "300000");
  assert.equal(extractSwapTx([tx]).data, "0xabcdef01");
  assert.throws(() => extractSwapTx([{ tx: { to: "nope", data: "0xabcdef01" } }]), { code: "BAD_SWAP_RESPONSE" });
  assert.throws(() => extractSwapTx({}), { code: "BAD_SWAP_RESPONSE" });
  assert.throws(() => extractSwapTx(null), { code: "BAD_SWAP_RESPONSE" });
});

test("assertSafeSwapTx rejects native value, token targets and approve/transfer calldata", () => {
  const ctx = { signer: USER, tokenIn: TOKENS.USDT.address, tokenOut: TOKENS.AAPLB.address };
  const ok = { to: ROUTER, data: "0x12345678abcdef" as const, value: "0" };
  assert.doesNotThrow(() => assertSafeSwapTx(ok, ctx));
  assert.throws(() => assertSafeSwapTx({ ...ok, value: "1" }, ctx), { code: "UNSAFE_TX" });
  assert.throws(() => assertSafeSwapTx({ ...ok, to: TOKENS.USDT.address }, ctx), { code: "UNSAFE_TX" });
  assert.throws(() => assertSafeSwapTx({ ...ok, to: USER }, ctx), { code: "UNSAFE_TX" });
  assert.throws(() => assertSafeSwapTx({ ...ok, data: encodeApprove(ROUTER, 1n) }, ctx), { code: "UNSAFE_TX" });
  assert.throws(() => assertSafeSwapTx({ ...ok, data: "0xa9059cbb00" }, ctx), { code: "UNSAFE_TX" });
});

// ---------- provider ----------

test("happy path with no approval needed: one tx, to the router", async () => {
  const f = fake({ allowance: 10n * E18 });
  const h = helperFor(f, async () => built());
  const q = await h.quote(buy);
  assert.equal(q.amountOut, "0.02");
  const sim = await h.simulate(q);
  assert.deepEqual([sim.ok, sim.needsApproval], [true, false]);
  const r = await h.execute(q, "main");
  assert.equal(r.receiver, "main");
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0]!.to, ROUTER);
});

test("approval path: exact amount to the quote's approveTarget, then re-build, then swap", async () => {
  const f = fake({ allowance: 0n });
  let builds = 0;
  const steps: string[] = [];
  const provider = createBinanceProvider({
    executor: f.exec,
    wallet: "main",
    build: async () => (builds++, built()),
    onProgress: (s) => steps.push(s),
  });
  const h = createSwapHelper(provider, { actor: "user" });
  const q = await h.quote(buy);
  assert.equal((await h.simulate(q)).needsApproval, true);
  await h.execute(q, "main");
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0]!.to, TOKENS.USDT.address);
  assert.deepEqual(decodeApprove(f.sent[0]!.data), { spender: APPROVE_TARGET, amount: 5n * E18 }); // exact, not unlimited
  assert.equal(f.sent[1]!.to, ROUTER);
  assert.equal(builds, 2, "quote once, then a fresh re-build before the swap");
  assert.deepEqual(steps, ["approving", "approval-confirmed", "rebuilding", "swapping", "confirming"]);
});

test("refuses when the price moved past the confirmed slippage floor", async () => {
  const f = fake({ allowance: 10n * E18 });
  let n = 0;
  // second build returns 2% less than what the user confirmed (limit is 0.5%)
  const h = helperFor(f, async () => (n++ === 0 ? built() : built({ amountOut: ((E18 / 50n) * 98n / 100n).toString() })));
  const q = await h.quote(buy);
  await h.simulate(q);
  await assert.rejects(h.execute(q, "main"), { code: "PRICE_MOVED" });
  assert.equal(f.sent.length, 0, "nothing was signed");
});

test("accepts a re-quote that is within slippage", async () => {
  const f = fake({ allowance: 10n * E18 });
  let n = 0;
  const h = helperFor(f, async () => (n++ === 0 ? built() : built({ amountOut: ((E18 / 50n) * 998n / 1000n).toString() })));
  const q = await h.quote(buy);
  await h.simulate(q);
  await h.execute(q, "main");
  assert.equal(f.sent.length, 1);
});

test("simulate fails on insufficient balance, wrong chain and a reverting dry run", async () => {
  const mk = async (over: Partial<Fake["state"]>) => {
    const f = fake({ allowance: 10n * E18, ...over });
    const h = helperFor(f, async () => built());
    return h.simulate(await h.quote(buy));
  };
  assert.match((await mk({ balance: E18 })).error!, /Not enough USDT/);
  assert.match((await mk({ chain: 1 })).error!, /BNB Smart Chain/);
  assert.equal((await mk({ dryRunFails: true })).ok, false);
});

test("a failed simulation blocks execute (helper gate) and nothing is sent", async () => {
  const f = fake({ allowance: 10n * E18, dryRunFails: true });
  const h = helperFor(f, async () => built());
  const q = await h.quote(buy);
  assert.equal((await h.simulate(q)).ok, false);
  await assert.rejects(h.execute(q, "main"), { code: "NOT_SIMULATED" });
  assert.equal(f.sent.length, 0);
});

test("approval that reverts stops before any swap is sent", async () => {
  const f = fake({ allowance: 0n, receipt: "reverted" });
  const h = helperFor(f, async () => built());
  const q = await h.quote(buy);
  await h.simulate(q);
  await assert.rejects(h.execute(q, "main"), { code: "APPROVAL_FAILED" });
  assert.equal(f.sent.length, 1);
});

test("swap that reverts on-chain reports SWAP_REVERTED; lost receipt reports RECEIPT_UNKNOWN with the hash", async () => {
  let f = fake({ allowance: 10n * E18, receipt: "reverted" });
  let h = helperFor(f, async () => built());
  let q = await h.quote(buy);
  await h.simulate(q);
  await assert.rejects(h.execute(q, "main"), { code: "SWAP_REVERTED" });

  f = fake({ allowance: 10n * E18, receipt: "throw" });
  h = helperFor(f, async () => built());
  q = await h.quote(buy);
  await h.simulate(q);
  await assert.rejects(h.execute(q, "main"), (e: Error & { code?: string }) => e.code === "RECEIPT_UNKNOWN" && e.message.includes("0x" + "0".repeat(63) + "1"));
});

test("unsafe or mismatched server response is refused at quote time", async () => {
  const f = fake();
  await assert.rejects(helperFor(f, async () => built({ tx: { to: ROUTER, data: "0x12345678", value: "1000" } })).quote(buy), { code: "UNSAFE_TX" });
  await assert.rejects(helperFor(f, async () => built({ amountIn: (6n * E18).toString() })).quote(buy), { code: "BAD_SWAP_RESPONSE" });
  await assert.rejects(helperFor(f, async () => built()).quote({ ...buy, tokenOut: "AAPLx" }), { code: "UNSUPPORTED_ROUTE" });
});

test("provider is bound to one wallet: main provider refuses session, session provider refuses main", async () => {
  const f = fake();
  const mainProv = createBinanceProvider({ executor: f.exec, wallet: "main", build: async () => built() });
  await assert.rejects(mainProv.quote({ ...buy, spender: "session", receiver: "session" }), { code: "WALLET_MISMATCH" });
  const sessProv = createBinanceProvider({ executor: f.exec, wallet: "session", build: async () => built() });
  await assert.rejects(sessProv.quote(buy), { code: "WALLET_MISMATCH" });
  // agent helper on top of a session provider works only with session/session
  const agent = helperFor(f, async () => built(), "session", "agent");
  await assert.rejects(agent.quote(buy), { code: "AGENT_MAIN_FORBIDDEN" });
  const q = await agent.quote({ ...buy, spender: "session", receiver: "session" });
  assert.equal(q.request.receiver, "session");
});

test("stale quote (>30s) is refused even for a plain swap, and a double click cannot send twice", async () => {
  let t = 1_000_000;
  const f = fake({ allowance: 10n * E18 });
  const p = createBinanceProvider({ executor: f.exec, wallet: "main", build: async () => built(), now: () => t });
  const h = createSwapHelper(p, { actor: "user", now: () => t });
  const q = await h.quote(buy);
  await h.simulate(q);
  t += 30_001;
  await assert.rejects(h.execute(q, "main"), { code: "QUOTE_EXPIRED" });

  t = 2_000_000;
  const q2 = await h.quote(buy);
  await h.simulate(q2);
  const [a, b] = await Promise.allSettled([h.execute(q2, "main"), h.execute(q2, "main")]);
  assert.equal([a, b].filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.sent.length, 1);
});

// ---------- real captured Binance /swap response (2026-10-09, wallet address replaced) ----------

import { readFileSync } from "node:fs";
import { assertMinReceive, extractSwapAmountOut } from "./swap-build";

const real = JSON.parse(readFileSync(new URL("./fixtures/binance-swap-real.json", import.meta.url), "utf8"));

test("real /swap response: parser finds the tx, amounts and Binance's own minimum", () => {
  const tx = extractSwapTx(real.data);
  assert.equal(tx.to, "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5");
  assert.equal(tx.from, USER);
  assert.equal(tx.value, "0");
  assert.equal(tx.gas, "250000");
  assert.equal(tx.data.slice(0, 10), "0xad43f73d");
  assert.equal(extractSwapAmountOut(real.data), 14823928166388643n);
  // our integer slippage math reproduces Binance's minReceiveAmount exactly
  assert.equal(minAmountOutFor(14823928166388643n, 50).toString(), tx.minReceive);
  assert.doesNotThrow(() => assertMinReceive(tx, 14823928166388643n, 50));
  assert.doesNotThrow(() =>
    assertSafeSwapTx(tx, { signer: USER, tokenIn: TOKENS.USDT.address, tokenOut: TOKENS.AAPLB.address }),
  );
});

test("real response is refused for a different signer or a looser Binance minimum", () => {
  const tx = extractSwapTx(real.data);
  const ctx = { tokenIn: TOKENS.USDT.address, tokenOut: TOKENS.AAPLB.address };
  assert.throws(() => assertSafeSwapTx(tx, { ...ctx, signer: ROUTER }), { code: "UNSAFE_TX" });
  assert.throws(() => assertMinReceive({ ...tx, minReceive: "1" }, 14823928166388643n, 50), { code: "UNSAFE_TX" });
});

test("provider refuses a built swap whose own minimum is looser than the confirmed slippage", async () => {
  const f = fake();
  const loose = built({ tx: { to: ROUTER, data: "0x12345678abcdef", value: "0", minReceive: "1" } });
  await assert.rejects(helperFor(f, async () => loose).quote(buy), { code: "UNSAFE_TX" });
});
