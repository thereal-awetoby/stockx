import { RFQ_TTL_MS } from "./constants";
import type { ChainInfo } from "./chains";
import type { TxRequest, WalletExecutor } from "./binance-provider";
import { QuoteExpiredError, SwapError } from "./errors";
import { decodeApprove, encodeApprove, formatUnitsStr, parseUnitsStr, type Hex } from "./swap-build";
import type { VeloraPriceRoute } from "./velora";
import type { ExecutionResult, Quote, QuoteRequest, SimulationResult, SwapProvider, Wallet } from "./types";

export interface DexToken { symbol: string; address: string; decimals: number }

/** What our server returns for one swap: the route and the transaction built from it. */
export interface BuiltDex {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  slippageBps: number;
  approveTarget: string;
  route: VeloraPriceRoute;
  tx: { to: string; data: string; value: string; from?: string };
}

export type DexBuildFn = (p: { chain: ChainInfo; tokenIn: DexToken; tokenOut: DexToken; amountIn: bigint; wallet: string; slippageBps: number }) => Promise<BuiltDex>;

/** Default builder: our own server route, which calls Velora. */
export const fetchBuiltDex: DexBuildFn = async ({ chain, tokenIn, tokenOut, amountIn, wallet, slippageBps }) => {
  const qs = new URLSearchParams({ chain: chain.key, tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol, amount: formatUnitsStr(amountIn, tokenIn.decimals), wallet, slippageBps: String(slippageBps) });
  const res = await fetch(`/api/swap/dex/build?${qs}`, { cache: "no-store" });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new SwapError(typeof j?.code === "string" ? j.code : "BUILD_FAILED", j?.error ?? `Swap build failed (HTTP ${res.status})`);
  return j as BuiltDex;
};

export type DexProgressStep = "approving" | "approval-confirmed" | "rebuilding" | "swapping" | "confirming";

export interface DexProviderOptions {
  executor: WalletExecutor;
  wallet: Wallet;
  chain: ChainInfo;
  /** Finds a stock token on this chain by symbol, e.g. "AAPLon". */
  stock: (symbol: string) => DexToken | undefined;
  slippageBps?: number;
  build?: DexBuildFn;
  now?: () => number;
  onProgress?: (step: DexProgressStep, detail?: { txHash?: string }) => void;
}

const DEFAULT_SLIPPAGE_BPS = 50;
const lc = (s: string) => s.toLowerCase();
const mul = (a: bigint, bps: number) => (a * BigInt(bps)) / 10_000n;

interface Raw { built: BuiltDex; tokenIn: DexToken; tokenOut: DexToken }

/**
 * Swap provider for chains served by a DEX aggregator (Ethereum first). Same safety shape as the
 * Binance provider: exact approvals only, simulate before send, re-quote before sending and refuse
 * if the price moved past the floor the user confirmed. Pay token is the chain's stablecoin; the
 * other leg is one stock token. No minimum order of our own.
 */
export function createDexProvider(opts: DexProviderOptions): SwapProvider {
  const { executor, wallet, chain } = opts;
  const slippageBps = opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const build = opts.build ?? fetchBuiltDex;
  const now = opts.now ?? Date.now;
  const progress = opts.onProgress ?? (() => {});
  let busy = false;

  function resolve(req: QuoteRequest): { tokenIn: DexToken; tokenOut: DexToken } {
    const cash: DexToken = chain.cash;
    const find = (s: string): DexToken => {
      if (s === cash.symbol) return cash;
      const t = opts.stock(s);
      if (!t) throw new SwapError("UNKNOWN_TOKEN", `${s} is not available on ${chain.name}`);
      return t;
    };
    const tokenIn = find(req.tokenIn);
    const tokenOut = find(req.tokenOut);
    if ((tokenIn === cash) === (tokenOut === cash)) {
      throw new SwapError("UNSUPPORTED_PAIR", `Swaps on ${chain.name} are ${cash.symbol} to a stock token or back`);
    }
    return { tokenIn, tokenOut };
  }

  function assertWallet(req: QuoteRequest) {
    if (req.spender !== wallet || req.receiver !== wallet) throw new SwapError("WALLET_MISMATCH", `This provider only signs for the ${wallet} wallet`);
  }

  async function assertChain() {
    if ((await executor.chainId()) !== chain.id) throw new SwapError("WRONG_CHAIN", `Switch your wallet to ${chain.name} (chain ${chain.id})`);
  }

  async function receiptOrUnknown(hash: string) {
    try {
      return await executor.waitForReceipt(hash);
    } catch {
      throw new SwapError("RECEIPT_UNKNOWN", `Sent (${hash}) but could not confirm it. Check the explorer before trying again.`);
    }
  }

  /** The built transaction must be exactly the swap that was asked for, signed by this wallet only. */
  function checkBuilt(b: BuiltDex, tokenIn: DexToken, tokenOut: DexToken, amountIn: bigint) {
    const r = b.route;
    if (lc(r.srcToken) !== lc(tokenIn.address) || lc(r.destToken) !== lc(tokenOut.address) || BigInt(r.srcAmount) !== amountIn || BigInt(b.amountIn) !== amountIn) {
      throw new SwapError("BAD_SWAP_RESPONSE", "Server built a different swap than was requested");
    }
    if (lc(b.tx.to) !== lc(r.contractAddress)) throw new SwapError("UNSAFE_TX", "Swap transaction does not call the quoted router");
    if (lc(b.approveTarget) !== lc(r.tokenTransferProxy)) throw new SwapError("UNSAFE_TX", "Approval target does not match the quoted route");
    if (BigInt(b.tx.value || "0") !== 0n) throw new SwapError("UNSAFE_TX", "Swap would send native currency");
    if (b.tx.from && lc(b.tx.from) !== lc(executor.address)) throw new SwapError("UNSAFE_TX", "Swap was built for a different wallet");
    if (!/^0x[0-9a-fA-F]{8,}$/.test(b.tx.data)) throw new SwapError("UNSAFE_TX", "Swap calldata is malformed");
    if (BigInt(b.amountOut) <= 0n) throw new SwapError("BAD_SWAP_RESPONSE", "Quote returned nothing to receive");
  }

  const txOf = (b: BuiltDex): TxRequest => ({ to: b.tx.to, data: b.tx.data as Hex, value: "0" });

  return {
    async quote(req) {
      assertWallet(req);
      const { tokenIn, tokenOut } = resolve(req);
      const amountIn = parseUnitsStr(req.amountIn, tokenIn.decimals);
      if (amountIn <= 0n) throw new SwapError("BAD_AMOUNT", "Amount must be greater than 0");
      const built = await build({ chain, tokenIn, tokenOut, amountIn, wallet: executor.address, slippageBps });
      checkBuilt(built, tokenIn, tokenOut, amountIn);
      return {
        id: `dex-${chain.key}-${now()}`,
        style: "swap",
        request: req,
        amountOut: formatUnitsStr(BigInt(built.amountOut), tokenOut.decimals),
        issuedAt: now(),
        raw: { built, tokenIn, tokenOut } satisfies Raw,
      };
    },

    async simulate(q): Promise<SimulationResult> {
      try {
        assertWallet(q.request);
        const { built, tokenIn, tokenOut } = q.raw as Raw;
        const amountIn = BigInt(built.amountIn);
        checkBuilt(built, tokenIn, tokenOut, amountIn);
        await assertChain();
        const balance = await executor.tokenBalance(tokenIn.address);
        if (balance < amountIn) {
          return { ok: false, error: `Not enough ${tokenIn.symbol}: have ${formatUnitsStr(balance, tokenIn.decimals)}, need ${formatUnitsStr(amountIn, tokenIn.decimals)}` };
        }
        if ((await executor.allowance(tokenIn.address, built.approveTarget)) < amountIn) {
          // The swap would revert until the approval is mined, so dry-run the approval instead.
          const gas = await executor.dryRun({ to: tokenIn.address, data: encodeApprove(built.approveTarget, amountIn), value: "0" });
          return { ok: true, gasEstimate: gas.toString(), needsApproval: true };
        }
        const gas = await executor.dryRun(txOf(built));
        return { ok: true, gasEstimate: gas.toString(), needsApproval: false };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Simulation failed" };
      }
    },

    async execute(q, receiver): Promise<ExecutionResult> {
      assertWallet(q.request);
      if (receiver !== wallet) throw new SwapError("WALLET_MISMATCH", `This provider only signs for the ${wallet} wallet`);
      const { built: confirmed, tokenIn, tokenOut } = q.raw as Raw;
      const amountIn = BigInt(confirmed.amountIn);
      if (now() - q.issuedAt > RFQ_TTL_MS) throw new QuoteExpiredError();
      if (busy) throw new SwapError("BUSY", "A swap is already in progress");
      busy = true;
      try {
        checkBuilt(confirmed, tokenIn, tokenOut, amountIn);
        await assertChain();

        // 1. Exact approval, if needed. Never unlimited, never more than this swap.
        const spender = confirmed.approveTarget;
        if ((await executor.allowance(tokenIn.address, spender)) < amountIn) {
          const approveTx: TxRequest = { to: tokenIn.address, data: encodeApprove(spender, amountIn), value: "0" };
          const sent = decodeApprove(approveTx.data);
          if (!sent || sent.amount !== amountIn || sent.spender !== lc(spender)) throw new SwapError("UNSAFE_TX", "Approval calldata did not match the swap");
          await executor.dryRun(approveTx);
          progress("approving");
          const approveHash = await executor.send(approveTx);
          const rcpt = await receiptOrUnknown(approveHash);
          if (rcpt.status !== "success") throw new SwapError("APPROVAL_FAILED", `Approval reverted (${approveHash})`);
          if ((await executor.allowance(tokenIn.address, spender)) < amountIn) throw new SwapError("APPROVAL_FAILED", "Approval mined but allowance is still too low");
          progress("approval-confirmed", { txHash: approveHash });
        }

        // 2. Re-quote and rebuild: never send the old transaction.
        progress("rebuilding");
        const fresh = await build({ chain, tokenIn, tokenOut, amountIn, wallet: executor.address, slippageBps: confirmed.slippageBps });
        checkBuilt(fresh, tokenIn, tokenOut, amountIn);
        if (lc(fresh.approveTarget) !== lc(spender)) throw new SwapError("PRICE_MOVED", "Approval target changed after approval. Start again.");
        const floor = mul(BigInt(confirmed.amountOut), 10_000 - confirmed.slippageBps);
        if (BigInt(fresh.amountOut) < floor) {
          throw new SwapError("PRICE_MOVED", `Price moved: you would receive ${formatUnitsStr(BigInt(fresh.amountOut), tokenOut.decimals)} ${tokenOut.symbol}, below your limit of ${formatUnitsStr(floor, tokenOut.decimals)}. Get a new quote.`);
        }

        // 3. Dry run the real swap (it reverts if the on-chain price is already past slippage), then send.
        await executor.dryRun(txOf(fresh));
        progress("swapping");
        const hash = await executor.send(txOf(fresh));
        progress("confirming", { txHash: hash });
        const rcpt = await receiptOrUnknown(hash);
        if (rcpt.status !== "success") throw new SwapError("SWAP_REVERTED", `Swap reverted on-chain (${hash}). Do not retry the same quote.`);
        return { txHash: hash, receiver };
      } finally {
        busy = false;
      }
    },
  };
}
