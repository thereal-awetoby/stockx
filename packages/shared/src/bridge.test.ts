import assert from "node:assert/strict";
import test from "node:test";
import type { TxRequest, WalletExecutor } from "./binance-provider";
import { assertSafeBridge, bridgeSource, bridgeTarget, executeBridge, NATIVE_ADDRESS, type BridgeBuilt, type BridgeRequest } from "./bridge";
import { decodeApprove } from "./swap-build";

const USDT = bridgeSource("bsc");
const USDC = bridgeTarget("ethereum", "cash");
const GAS = bridgeTarget("ethereum", "gas");
const DIAMOND = "0x" + "ab".repeat(20);
const AMOUNT = 20n * 10n ** 18n;
const req: BridgeRequest = { fromChain: 56, toChain: 1, fromToken: USDT.address, toToken: USDC.address, fromAmount: AMOUNT };

const built = (over: Partial<BridgeBuilt> = {}): BridgeBuilt => ({
  fromChain: 56, toChain: 1, fromToken: USDT.address, toToken: USDC.address, fromAmount: AMOUNT.toString(),
  toAmount: "19500000", toAmountMin: "19400000", approvalAddress: DIAMOND,
  tx: { to: DIAMOND, data: "0x1234567890abcdef", value: "0", chainId: 56 },
  tool: "across", feeUsd: 0.4, gasUsd: 0.1, durationSec: 60, ...over,
});

function fakeExecutor(o: { chainId?: number; balance?: bigint; allowance?: bigint; receiptFails?: boolean } = {}) {
  const sent: TxRequest[] = [];
  let allowance = o.allowance ?? 0n;
  const ex: WalletExecutor = {
    address: "0x" + "aa".repeat(20),
    chainId: async () => o.chainId ?? 56,
    tokenBalance: async () => o.balance ?? AMOUNT * 2n,
    allowance: async () => allowance,
    dryRun: async () => 100_000n,
    send: async (tx) => { sent.push(tx); const a = decodeApprove(tx.data); if (a) allowance = a.amount; return "0x" + String(sent.length).padStart(64, "0"); },
    waitForReceipt: async () => { if (o.receiptFails) throw new Error("timeout"); return { status: "success" }; },
  };
  return { ex, sent };
}

test("a matching quote passes", () => assert.doesNotThrow(() => assertSafeBridge(built(), req)));

test("wrong amount, token, chain, target or value are refused", () => {
  assert.throws(() => assertSafeBridge(built({ fromAmount: "1" }), req), /different amount/);
  assert.throws(() => assertSafeBridge(built({ toToken: GAS.address }), req), /different tokens/);
  assert.throws(() => assertSafeBridge(built({ tx: { ...built().tx, chainId: 1 } }), req), /different chain/);
  assert.throws(() => assertSafeBridge(built({ tx: { ...built().tx, to: "0x" + "cd".repeat(20) } }), req), /does not call/);
  assert.throws(() => assertSafeBridge(built({ tx: { ...built().tx, value: "1" } }), req), /native currency/);
  assert.throws(() => assertSafeBridge(built({ toAmountMin: "10000000" }), req), /too much slippage/);
});

test("approves the exact amount, rebuilds, then sends once", async () => {
  const { ex, sent } = fakeExecutor();
  const steps: string[] = [];
  const res = await executeBridge({ executor: ex, built: built(), request: req, rebuild: async () => built(), onProgress: (s) => steps.push(s) });
  assert.equal(sent.length, 2);
  const approval = decodeApprove(sent[0].data)!;
  assert.equal(approval.amount, AMOUNT);
  assert.equal(approval.spender, DIAMOND);
  assert.equal(sent[1].to, DIAMOND);
  assert.deepEqual(steps, ["approving", "approval-confirmed", "rebuilding", "sending", "sent"]);
  assert.ok(res.txHash);
});

test("skips the approval when the allowance already covers it", async () => {
  const { ex, sent } = fakeExecutor({ allowance: AMOUNT });
  await executeBridge({ executor: ex, built: built(), request: req, rebuild: async () => built() });
  assert.equal(sent.length, 1);
});

test("refuses on the wrong chain or a low balance, sending nothing", async () => {
  const a = fakeExecutor({ chainId: 1 });
  await assert.rejects(executeBridge({ executor: a.ex, built: built(), request: req, rebuild: async () => built() }), /Switch your wallet/);
  const b = fakeExecutor({ balance: 1n });
  await assert.rejects(executeBridge({ executor: b.ex, built: built(), request: req, rebuild: async () => built() }), /Not enough balance/);
  assert.equal(a.sent.length + b.sent.length, 0);
});

test("a worse fresh quote stops before the bridge is sent", async () => {
  const { ex, sent } = fakeExecutor({ allowance: AMOUNT });
  await assert.rejects(executeBridge({ executor: ex, built: built(), request: req, rebuild: async () => built({ toAmountMin: "19000000", toAmount: "19500000" }) }), /got worse/);
  assert.equal(sent.length, 0);
});

test("native source must send exactly the amount as value", () => {
  const nreq: BridgeRequest = { ...req, fromToken: NATIVE_ADDRESS };
  const b = built({ fromToken: NATIVE_ADDRESS, tx: { ...built().tx, value: AMOUNT.toString() } });
  assert.doesNotThrow(() => assertSafeBridge(b, nreq, { sourceNative: true }));
  assert.throws(() => assertSafeBridge(built({ fromToken: NATIVE_ADDRESS }), nreq, { sourceNative: true }), /native currency/);
});
