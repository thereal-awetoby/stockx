import assert from "node:assert/strict";
import test from "node:test";
import type { TxRequest, WalletExecutor } from "./binance-provider";
import { CHAINS } from "./chains";
import { createDexProvider, type BuiltDex, type DexBuildFn, type DexToken } from "./dex-provider";
import { decodeApprove } from "./swap-build";

const chain = CHAINS.ethereum;
const WALLET = "0x" + "aa".repeat(20);
const ROUTER = "0x" + "bb".repeat(20);
const PROXY = "0x" + "cc".repeat(20);
const AAPL: DexToken = { symbol: "AAPLon", address: "0x" + "dd".repeat(20), decimals: 18 };
const stock = (s: string) => (s === "AAPLon" ? AAPL : undefined);
const USD2 = 2_000_000n; // 2 USDC (6 decimals)
const OUT = 6n * 10n ** 15n; // 0.006 AAPLon

const built = (out: bigint, over: Partial<BuiltDex> = {}): BuiltDex => ({
  tokenIn: "USDC", tokenOut: "AAPLon", amountIn: USD2.toString(), amountOut: out.toString(), slippageBps: 50, approveTarget: PROXY,
  route: { srcToken: chain.cash.address, destToken: AAPL.address, srcAmount: USD2.toString(), destAmount: out.toString(), srcDecimals: 6, destDecimals: 18, tokenTransferProxy: PROXY, contractAddress: ROUTER },
  tx: { to: ROUTER, data: "0x1234567890abcdef", value: "0", from: WALLET },
  ...over,
});

function fakeExecutor(o: { chainId?: number; balance?: bigint; allowance?: bigint } = {}) {
  const sent: TxRequest[] = [];
  let allowance = o.allowance ?? 0n;
  const ex: WalletExecutor = {
    address: WALLET,
    chainId: async () => o.chainId ?? 1,
    tokenBalance: async () => o.balance ?? 10_000_000n,
    allowance: async () => allowance,
    dryRun: async () => 100_000n,
    send: async (tx) => { sent.push(tx); if (decodeApprove(tx.data)) allowance = decodeApprove(tx.data)!.amount; return `0xhash${sent.length}`; },
    waitForReceipt: async () => ({ status: "success" }),
  };
  return { ex, sent };
}

const req = { tokenIn: "USDC", tokenOut: "AAPLon", amountIn: "2", spender: "main", receiver: "main" } as const;
const provider = (ex: WalletExecutor, build: DexBuildFn) => createDexProvider({ executor: ex, wallet: "main", chain, stock, build });

test("buy: exact approval first, then the swap, no minimum order", async () => {
  const { ex, sent } = fakeExecutor();
  const p = provider(ex, async () => built(OUT));
  const q = await p.quote(req);
  assert.equal(q.amountOut, "0.006");
  assert.deepEqual(await p.simulate(q), { ok: true, gasEstimate: "100000", needsApproval: true });
  const res = await p.execute(q, "main");
  assert.equal(sent.length, 2);
  const approve = decodeApprove(sent[0].data)!;
  assert.equal(approve.amount, USD2);
  assert.equal(approve.spender, PROXY);
  assert.equal(sent[1].to, ROUTER);
  assert.equal(res.txHash, "0xhash2");
});

test("refuses a transaction that does not call the quoted router", async () => {
  const { ex } = fakeExecutor();
  const p = provider(ex, async () => built(OUT, { tx: { to: "0x" + "ee".repeat(20), data: "0x1234567890abcdef", value: "0" } }));
  await assert.rejects(() => p.quote(req), /quoted router/);
});

test("refuses to send native currency or a transaction built for another wallet", async () => {
  const { ex } = fakeExecutor();
  await assert.rejects(() => provider(ex, async () => built(OUT, { tx: { to: ROUTER, data: "0x1234567890abcdef", value: "1" } })).quote(req), /native currency/);
  await assert.rejects(() => provider(ex, async () => built(OUT, { tx: { to: ROUTER, data: "0x1234567890abcdef", value: "0", from: "0x" + "99".repeat(20) } })).quote(req), /different wallet/);
});

test("simulate reports the wrong chain and a low balance", async () => {
  const q = await provider(fakeExecutor().ex, async () => built(OUT)).quote(req);
  assert.match((await provider(fakeExecutor({ chainId: 56 }).ex, async () => built(OUT)).simulate(q)).error ?? "", /Switch your wallet to Ethereum/);
  assert.match((await provider(fakeExecutor({ balance: 1n }).ex, async () => built(OUT)).simulate(q)).error ?? "", /Not enough USDC/);
});

test("execute refuses when the price moved past the confirmed floor", async () => {
  const { ex, sent } = fakeExecutor({ allowance: USD2 });
  let calls = 0;
  const p = provider(ex, async () => built(calls++ === 0 ? OUT : OUT / 2n));
  const q = await p.quote(req);
  await assert.rejects(() => p.execute(q, "main"), /Price moved/);
  assert.equal(sent.length, 0);
});

test("only the stablecoin to a stock and back is supported", async () => {
  const p = provider(fakeExecutor().ex, async () => built(OUT));
  await assert.rejects(() => p.quote({ ...req, tokenOut: "NOPEon" }), /not available on Ethereum/);
  await assert.rejects(() => p.quote({ ...req, tokenIn: "AAPLon", tokenOut: "AAPLon" }), /USDC to a stock token/);
});
