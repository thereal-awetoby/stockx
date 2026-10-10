import { CHAIN_ID, RFQ_TTL_MS } from "./constants";
import { QuoteExpiredError, SwapError } from "./errors";
import {
  assertMinReceive,
  assertSafeSwapTx,
  decodeApprove,
  encodeApprove,
  formatUnitsStr,
  parseUnitsStr,
  resolvePair,
  type BuiltSwap,
  type Hex,
  type Pair,
  type Side,
} from "./swap-build";
import type { ExecutionResult, Quote, QuoteRequest, SimulationResult, SwapProvider, Wallet } from "./types";

/** A transaction as the executor sends it. `value` is wei as a decimal string. */
export interface TxRequest {
  to: string;
  data: Hex;
  value: string;
  gas?: string;
}

/**
 * The signer binding. One executor = one wallet. The DIY path is given the connected
 * main wallet, the agent path is given the session wallet. A provider never sees both,
 * so the agent provider cannot sign with main even if every other guard failed.
 */
export interface WalletExecutor {
  readonly address: string;
  chainId(): Promise<number>;
  tokenBalance(token: string): Promise<bigint>;
  allowance(token: string, spender: string): Promise<bigint>;
  /** eth_call / estimateGas. MUST throw if the transaction would revert. Returns gas units. */
  dryRun(tx: TxRequest): Promise<bigint>;
  /** Signs and broadcasts. Returns the tx hash. */
  send(tx: TxRequest): Promise<string>;
  /** Resolves when mined. */
  waitForReceipt(hash: string): Promise<{ status: "success" | "reverted" }>;
}

export type BuildFn = (p: { side: Side; /** Stock token symbol, e.g. "AAPLB". The other leg is always USDT. */ token: string; amount: string; wallet: string; slippageBps: number }) => Promise<BuiltSwap>;

/** Default builder: our own server route. */
export const fetchBuiltSwap: BuildFn = async ({ side, token, amount, wallet, slippageBps }) => {
  const qs = new URLSearchParams({ side, token, amount, wallet, slippageBps: String(slippageBps) });
  const res = await fetch(`/api/swap/build?${qs.toString()}`, { cache: "no-store" });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new SwapError(typeof j?.code === "string" ? j.code : "BUILD_FAILED", j?.error ?? `Swap build failed (HTTP ${res.status})`);
  return j as BuiltSwap;
};

export type ProgressStep = "approving" | "approval-confirmed" | "rebuilding" | "swapping" | "confirming";

export interface BinanceProviderOptions {
  executor: WalletExecutor;
  /** Which wallet this provider signs for. Requests for the other wallet are refused. */
  wallet: Wallet;
  slippageBps?: number;
  build?: BuildFn;
  now?: () => number;
  onProgress?: (step: ProgressStep, detail?: { txHash?: string }) => void;
}

const DEFAULT_SLIPPAGE_BPS = 50;

interface Raw {
  built: BuiltSwap;
  pair: Pair;
}

const mul = (a: bigint, bps: number) => (a * BigInt(bps)) / 10_000n;

/**
 * Real swap provider on the Binance Web3 aggregator.
 *
 *  quote    -> fresh build from our server (quote + swap tx)
 *  simulate -> balance, chain, allowance, and a dry run of the swap (or of the approval
 *              when the swap cannot be simulated until the approval is mined)
 *  execute  -> exact approval if needed, wait, RE-BUILD from a fresh quote, refuse if the
 *              price moved past the slippage the user confirmed, dry run, send, wait
 *
 * createSwapHelper still wraps this and enforces actor rules, expiry and
 * simulate-before-execute; those checks are not duplicated here except where this
 * provider holds a signer and so adds its own belt-and-braces.
 */
export function createBinanceProvider(opts: BinanceProviderOptions): SwapProvider {
  const { executor, wallet } = opts;
  const slippageBps = opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const build = opts.build ?? fetchBuiltSwap;
  const now = opts.now ?? Date.now;
  const progress = opts.onProgress ?? (() => {});
  let busy = false;

  const rawOf = (q: Quote): Raw => {
    const r = q.raw as Raw | undefined;
    if (!r?.built || !r.pair) throw new SwapError("BAD_QUOTE", "Quote was not produced by this provider");
    return r;
  };

  function assertWallet(req: QuoteRequest) {
    if (req.spender !== wallet || req.receiver !== wallet) {
      throw new SwapError("WALLET_MISMATCH", `This provider only signs for the ${wallet} wallet`);
    }
  }

  async function assertChain() {
    const id = await executor.chainId();
    if (id !== CHAIN_ID) throw new SwapError("WRONG_CHAIN", `Switch your wallet to BNB Smart Chain (chain ${CHAIN_ID})`);
  }

  /** Once a tx is broadcast, losing the receipt is NOT a failure: surface the hash, never auto-retry. */
  async function receiptOrUnknown(hash: string) {
    try {
      return await executor.waitForReceipt(hash);
    } catch {
      throw new SwapError("RECEIPT_UNKNOWN", `Sent (${hash}) but could not confirm it. Check the explorer before trying again.`);
    }
  }

  function checkBuilt(b: BuiltSwap, pair: Pair, amountIn: bigint) {
    if (b.tokenIn !== pair.tokenIn.symbol || b.tokenOut !== pair.tokenOut.symbol || BigInt(b.amountIn) !== amountIn) {
      throw new SwapError("BAD_SWAP_RESPONSE", "Server built a different swap than was requested");
    }
    assertSafeSwapTx(b.tx, { signer: executor.address, tokenIn: pair.tokenIn.address, tokenOut: pair.tokenOut.address });
    assertMinReceive(b.tx, BigInt(b.amountOut), b.slippageBps);
  }

  return {
    async quote(req) {
      assertWallet(req);
      const pair = resolvePair(req.tokenIn, req.tokenOut);
      const amountIn = parseUnitsStr(req.amountIn, pair.tokenIn.decimals);
      if (amountIn <= 0n) throw new SwapError("BAD_AMOUNT", "Amount must be greater than 0");
      const built = await build({ side: pair.side, token: pair.stock.symbol, amount: req.amountIn, wallet: executor.address, slippageBps });
      checkBuilt(built, pair, amountIn);
      const issuedAt = now();
      const rfq = built.executionMode.toUpperCase().includes("RFQ");
      return {
        id: built.quoteId,
        style: rfq ? "rfq" : "swap",
        request: req,
        amountOut: formatUnitsStr(BigInt(built.amountOut), pair.tokenOut.decimals),
        issuedAt,
        expiresAt: rfq ? issuedAt + RFQ_TTL_MS : undefined,
        raw: { built, pair } satisfies Raw,
      };
    },

    async simulate(q): Promise<SimulationResult> {
      try {
        assertWallet(q.request);
        const { built, pair } = rawOf(q);
        const amountIn = BigInt(built.amountIn);
        checkBuilt(built, pair, amountIn);
        await assertChain();

        const balance = await executor.tokenBalance(pair.tokenIn.address);
        if (balance < amountIn) {
          return { ok: false, error: `Not enough ${pair.tokenIn.symbol}: have ${formatUnitsStr(balance, pair.tokenIn.decimals)}, need ${formatUnitsStr(amountIn, pair.tokenIn.decimals)}` };
        }

        const allowance = await executor.allowance(pair.tokenIn.address, built.approveTarget);
        if (allowance < amountIn) {
          // The swap would revert until the approval is mined, so dry-run the approval instead.
          const approveTx: TxRequest = { to: pair.tokenIn.address, data: encodeApprove(built.approveTarget, amountIn), value: "0" };
          const gas = await executor.dryRun(approveTx);
          return { ok: true, gasEstimate: gas.toString(), needsApproval: true };
        }
        const gas = await executor.dryRun(built.tx);
        return { ok: true, gasEstimate: gas.toString(), needsApproval: false };
      } catch (e) {
        if (e instanceof SwapError && e.code === "WRONG_CHAIN") return { ok: false, error: e.message };
        return { ok: false, error: e instanceof Error ? e.message : "Simulation failed" };
      }
    },

    async execute(q, receiver): Promise<ExecutionResult> {
      assertWallet(q.request);
      if (receiver !== wallet) throw new SwapError("WALLET_MISMATCH", `This provider only signs for the ${wallet} wallet`);
      const { built: confirmed, pair } = rawOf(q);
      const amountIn = BigInt(confirmed.amountIn);
      // Anything past 30s is stale for us even if the aggregator calls it a plain swap.
      if (now() - q.issuedAt > RFQ_TTL_MS) throw new QuoteExpiredError();
      if (busy) throw new SwapError("BUSY", "A swap is already in progress");
      busy = true;
      try {
        checkBuilt(confirmed, pair, amountIn);
        await assertChain();

        // 1. Exact approval, if needed. Never unlimited, never more than this swap.
        const spender = confirmed.approveTarget;
        if ((await executor.allowance(pair.tokenIn.address, spender)) < amountIn) {
          const approveTx: TxRequest = { to: pair.tokenIn.address, data: encodeApprove(spender, amountIn), value: "0" };
          const sent = decodeApprove(approveTx.data);
          if (!sent || sent.amount !== amountIn || sent.spender !== spender.toLowerCase()) {
            throw new SwapError("UNSAFE_TX", "Approval calldata did not match the swap");
          }
          await executor.dryRun(approveTx);
          progress("approving");
          const approveHash = await executor.send(approveTx);
          const rcpt = await receiptOrUnknown(approveHash);
          if (rcpt.status !== "success") throw new SwapError("APPROVAL_FAILED", `Approval reverted (${approveHash})`);
          if ((await executor.allowance(pair.tokenIn.address, spender)) < amountIn) {
            throw new SwapError("APPROVAL_FAILED", "Approval mined but allowance is still too low");
          }
          progress("approval-confirmed", { txHash: approveHash });
        }

        // 2. Re-quote and rebuild. The price may have moved while the approval confirmed
        //    (or while the user read the review screen). Never send the old transaction.
        progress("rebuilding");
        const fresh = await build({ side: pair.side, token: pair.stock.symbol, amount: formatUnitsStr(amountIn, pair.tokenIn.decimals), wallet: executor.address, slippageBps: confirmed.slippageBps });
        checkBuilt(fresh, pair, amountIn);
        if (fresh.approveTarget.toLowerCase() !== spender.toLowerCase()) {
          throw new SwapError("PRICE_MOVED", "Approval target changed after approval. Start again.");
        }
        // Slippage consistency: the user agreed to `confirmed.amountOut` minus slippage.
        // The fresh quote must still clear that same floor, and carry its own floor too.
        const floor = mul(BigInt(confirmed.amountOut), 10_000 - confirmed.slippageBps);
        if (BigInt(fresh.amountOut) < floor) {
          throw new SwapError(
            "PRICE_MOVED",
            `Price moved: you would receive ${formatUnitsStr(BigInt(fresh.amountOut), pair.tokenOut.decimals)} ${pair.tokenOut.symbol}, below your limit of ${formatUnitsStr(floor, pair.tokenOut.decimals)}. Get a new quote.`,
          );
        }

        // 3. Dry run the real swap now that the allowance exists, then send it.
        await executor.dryRun(fresh.tx);
        progress("swapping");
        const hash = await executor.send(fresh.tx);
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
