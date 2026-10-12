import type { TxRequest, WalletExecutor } from "./binance-provider";
import { CHAINS, type ChainKey } from "./chains";
import { SwapError } from "./errors";
import { ADDRESS_RE, decodeApprove, encodeApprove, formatUnitsStr, type Hex } from "./swap-build";

/** LI.FI uses this address for a chain's native coin (ETH, BNB). */
export const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

/** What the person gets on the other side: the stablecoin, or a little native coin to pay gas. */
export type BridgeTarget = "cash" | "gas";

export interface BridgeAsset { symbol: string; address: string; decimals: number; native: boolean }

/** The only assets the bridge page moves. Addresses come from here, never from the client. */
export function bridgeSource(chain: ChainKey): BridgeAsset {
  const c = CHAINS[chain].cash;
  return { symbol: c.symbol, address: c.address, decimals: c.decimals, native: false };
}
export function bridgeTarget(chain: ChainKey, target: BridgeTarget): BridgeAsset {
  if (target === "gas") return { symbol: CHAINS[chain].native, address: NATIVE_ADDRESS, decimals: 18, native: true };
  return bridgeSource(chain);
}

/** What our server returns for one bridge quote: the numbers and the transaction built from them. */
export interface BridgeBuilt {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  approvalAddress: string;
  tx: { to: string; data: string; value: string; chainId: number };
  tool: string;
  feeUsd: number | null;
  gasUsd: number | null;
  durationSec: number | null;
}

export interface BridgeRequest { fromChain: number; toChain: number; fromToken: string; toToken: string; fromAmount: bigint }

const lc = (s: string) => s.toLowerCase();
/** Refuse a quote that would deliver less than this share of the headline amount. */
const MAX_MIN_OUT_LOSS_BPS = 300n;

/** The built transaction must be exactly the bridge that was asked for. Fails closed. */
export function assertSafeBridge(b: BridgeBuilt, req: BridgeRequest, opts: { sourceNative?: boolean } = {}): void {
  const bad = (m: string) => new SwapError("BAD_BRIDGE_RESPONSE", m);
  if (b.fromChain !== req.fromChain || b.toChain !== req.toChain) throw bad("Bridge quote is for different chains than requested");
  if (lc(b.fromToken) !== lc(req.fromToken) || lc(b.toToken) !== lc(req.toToken)) throw bad("Bridge quote is for different tokens than requested");
  if (BigInt(b.fromAmount) !== req.fromAmount) throw bad("Bridge quote is for a different amount than requested");
  if (b.tx.chainId !== req.fromChain) throw new SwapError("UNSAFE_TX", "Bridge transaction is for a different chain");
  if (!ADDRESS_RE.test(b.tx.to) || !ADDRESS_RE.test(b.approvalAddress)) throw new SwapError("UNSAFE_TX", "Bridge target is not a valid contract address");
  if (lc(b.tx.to) !== lc(b.approvalAddress)) throw new SwapError("UNSAFE_TX", "Bridge transaction does not call the contract that gets the approval");
  if (!/^0x[0-9a-fA-F]{8,}$/.test(b.tx.data)) throw new SwapError("UNSAFE_TX", "Bridge calldata is malformed");
  const value = BigInt(b.tx.value || "0");
  if (opts.sourceNative ? value !== req.fromAmount : value !== 0n) throw new SwapError("UNSAFE_TX", "Bridge would send an unexpected amount of native currency");
  const out = BigInt(b.toAmount);
  const min = BigInt(b.toAmountMin);
  if (out <= 0n || min <= 0n || min > out) throw bad("Bridge quote returned nothing to receive");
  if (min * 10_000n < out * (10_000n - MAX_MIN_OUT_LOSS_BPS)) throw bad("Bridge quote allows too much slippage");
}

export type BridgeStep = "approving" | "approval-confirmed" | "rebuilding" | "sending" | "sent";

export interface BridgeExecuteOptions {
  executor: WalletExecutor;
  built: BridgeBuilt;
  request: BridgeRequest;
  /** Asks the server for a brand-new quote for the same bridge. */
  rebuild: () => Promise<BridgeBuilt>;
  onProgress?: (step: BridgeStep, detail?: { txHash?: string }) => void;
}

const lcEq = (a: string, b: string) => lc(a) === lc(b);

/**
 * Sends the bridge from the connected wallet: balance check, exact approval (never unlimited),
 * a fresh quote right before sending, a dry run, then one send. A lost receipt is reported with the
 * hash and is never retried. Returns the source-chain transaction hash.
 */
export async function executeBridge(o: BridgeExecuteOptions): Promise<{ txHash: string }> {
  const { executor, built, request } = o;
  const progress = o.onProgress ?? (() => {});
  const native = lcEq(request.fromToken, NATIVE_ADDRESS);
  assertSafeBridge(built, request, { sourceNative: native });
  if ((await executor.chainId()) !== request.fromChain) throw new SwapError("WRONG_CHAIN", "Switch your wallet to the chain you are bridging from");

  if (!native) {
    const balance = await executor.tokenBalance(request.fromToken);
    if (balance < request.fromAmount) throw new SwapError("INSUFFICIENT_BALANCE", "Not enough balance to bridge this amount");
    const spender = built.approvalAddress;
    if ((await executor.allowance(request.fromToken, spender)) < request.fromAmount) {
      const approveTx: TxRequest = { to: request.fromToken, data: encodeApprove(spender, request.fromAmount), value: "0" };
      const sent = decodeApprove(approveTx.data);
      if (!sent || sent.amount !== request.fromAmount || sent.spender !== lc(spender)) throw new SwapError("UNSAFE_TX", "Approval calldata did not match the bridge");
      await executor.dryRun(approveTx);
      progress("approving");
      const hash = await executor.send(approveTx);
      const rcpt = await executor.waitForReceipt(hash).catch(() => {
        throw new SwapError("RECEIPT_UNKNOWN", `Approval sent (${hash}) but could not be confirmed. Check the explorer before trying again.`);
      });
      if (rcpt.status !== "success") throw new SwapError("APPROVAL_FAILED", `Approval reverted (${hash})`);
      if ((await executor.allowance(request.fromToken, spender)) < request.fromAmount) throw new SwapError("APPROVAL_FAILED", "Approval mined but allowance is still too low");
      progress("approval-confirmed", { txHash: hash });
    }
  }

  progress("rebuilding");
  const fresh = await o.rebuild();
  assertSafeBridge(fresh, request, { sourceNative: native });
  if (!native && !lcEq(fresh.approvalAddress, built.approvalAddress)) throw new SwapError("PRICE_MOVED", "The bridge contract changed after approval. Start again.");
  const floor = (BigInt(built.toAmountMin) * 99n) / 100n;
  if (BigInt(fresh.toAmountMin) < floor) {
    throw new SwapError("PRICE_MOVED", "The bridge quote got worse while you were confirming. Get a new quote.");
  }

  const tx: TxRequest = { to: fresh.tx.to, data: fresh.tx.data as Hex, value: native ? fresh.tx.value : "0" };
  await executor.dryRun(tx);
  progress("sending");
  const txHash = await executor.send(tx);
  progress("sent", { txHash });
  return { txHash };
}

/** Human-readable view of a built bridge quote. */
export function describeBridge(b: BridgeBuilt, from: BridgeAsset, to: BridgeAsset) {
  return {
    send: formatUnitsStr(BigInt(b.fromAmount), from.decimals),
    receive: formatUnitsStr(BigInt(b.toAmount), to.decimals),
    receiveMin: formatUnitsStr(BigInt(b.toAmountMin), to.decimals),
  };
}

