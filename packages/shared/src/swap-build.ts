import { SwapError } from "./errors";
import { getTokenInfo, isLiveSymbol } from "./token-registry";

/**
 * Dependency-free helpers shared by the /api/swap/build route (server) and the
 * Binance provider (browser / agent). No viem, no ethers: this file must stay
 * importable from anywhere and testable without installing anything.
 */

export type Side = "buy" | "sell";
export type Hex = `0x${string}`;

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x([0-9a-fA-F]{2})*$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** ERC-20 selectors that must never appear as a *swap* transaction's calldata. */
const FORBIDDEN_SWAP_SELECTORS = new Set([
  "0x095ea7b3", // approve
  "0xa9059cbb", // transfer
  "0x23b872dd", // transferFrom
  "0x39509351", // increaseAllowance
]);

// ---------- units (BigInt, no floats) ----------

export function parseUnitsStr(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new SwapError("BAD_AMOUNT", `Invalid amount "${amount}"`);
  const [whole = "0", frac = ""] = amount.split(".");
  if (frac.length > decimals) throw new SwapError("BAD_AMOUNT", `Too many decimal places (max ${decimals})`);
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

export function formatUnitsStr(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const s = (neg ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

// ---------- ERC-20 approve, encoded by hand so it is independent of the API ----------

/** approve(spender, amount) calldata. Exact amount: callers never pass 2^256-1. */
export function encodeApprove(spender: string, amount: bigint): Hex {
  if (!ADDRESS_RE.test(spender)) throw new SwapError("BAD_SPENDER", "Invalid approval spender");
  if (amount <= 0n || amount >= 2n ** 255n) throw new SwapError("BAD_APPROVAL_AMOUNT", "Approval must be an exact, bounded amount");
  const addr = spender.slice(2).toLowerCase().padStart(64, "0");
  const amt = amount.toString(16).padStart(64, "0");
  return `0x095ea7b3${addr}${amt}`;
}

export function decodeApprove(data: string): { spender: string; amount: bigint } | null {
  if (!/^0x095ea7b3[0-9a-fA-F]{128}$/.test(data)) return null;
  return { spender: "0x" + data.slice(34, 74).toLowerCase(), amount: BigInt("0x" + data.slice(74)) };
}

// ---------- the swap transaction as our server returns it ----------

export interface SwapTx {
  /** Sender the API built this for. Must equal the signer when present. */
  from?: string;
  /** Binance's own minimum output (`minReceiveAmount`), base units. Cross-checked, never trusted alone. */
  minReceive?: string;
  to: string;
  data: Hex;
  /** Wei, decimal string. Must be "0" for token<->token swaps. */
  value: string;
  /** Gas limit suggested by the API, decimal string, if any. */
  gas?: string;
}

/** What /api/swap/build returns. Everything the browser needs, nothing secret. */
export interface BuiltSwap {
  side: Side;
  tokenIn: string;
  tokenOut: string;
  /** Raw integer strings (token base units). */
  amountIn: string;
  amountOut: string;
  /** Slippage floor in token-out base units (derived by us, not trusted from the API). */
  minAmountOut: string;
  slippageBps: number;
  executionMode: string;
  approveTarget: string;
  priceImpactPercent: string;
  route: string[];
  quoteId: string;
  gasEstimate: string;
  builtAt: number;
  tx: SwapTx;
}

export function minAmountOutFor(amountOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
    throw new SwapError("BAD_SLIPPAGE", "Slippage must be 0 to 1000 basis points");
  }
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const intString = (v: unknown): string | undefined => {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v).toString();
  return undefined;
};

/**
 * Verified 2026-10-09 against the live API: the response is `{ routerResult, tx, rfq }`
 * with `tx = { from, to, data, value, gas, minReceiveAmount, slippagePercent, ... }`
 * (see fixtures/binance-swap-real.json). The other branches are kept as fallbacks and
 * everything still fails closed with BAD_SWAP_RESPONSE if nothing valid is found.
 */
export function extractSwapTx(data: unknown): SwapTx {
  const first = Array.isArray(data) ? data[0] : data;
  const candidates: unknown[] = [];
  if (isObj(first)) candidates.push(first.tx, first.transaction, first);
  for (const c of candidates) {
    if (!isObj(c)) continue;
    const to = c.to ?? c.routerAddress ?? c.target;
    const calldata = c.data ?? c.calldata ?? c.input;
    if (typeof to !== "string" || !ADDRESS_RE.test(to)) continue;
    if (typeof calldata !== "string" || !HEX_RE.test(calldata) || calldata.length < 10) continue;
    const value = intString(c.value ?? "0");
    if (value === undefined) continue;
    const gas = intString(c.gas ?? c.gasLimit);
    const from = typeof c.from === "string" && ADDRESS_RE.test(c.from) ? c.from : undefined;
    const minReceive = intString(c.minReceiveAmount);
    return { to, data: calldata as Hex, value, ...(gas ? { gas } : {}), ...(from ? { from } : {}), ...(minReceive ? { minReceive } : {}) };
  }
  throw new SwapError("BAD_SWAP_RESPONSE", "Swap response did not contain a usable transaction");
}

/**
 * Last line of defence before anything is signed. Runs again in the browser even
 * though the server already ran it, because the browser never trusts the network.
 */
export function assertSafeSwapTx(tx: SwapTx, ctx: { signer: string; tokenIn: string; tokenOut: string }): void {
  const to = tx.to.toLowerCase();
  const bad = (m: string) => new SwapError("UNSAFE_TX", m);
  if (!ADDRESS_RE.test(tx.to) || to === ZERO_ADDRESS) throw bad("Swap target is not a valid contract address");
  if (tx.value !== "0") throw bad("Swap tries to send native BNB; token swaps must send 0");
  if (to === ctx.signer.toLowerCase()) throw bad("Swap target is the wallet itself");
  if (to === ctx.tokenIn.toLowerCase() || to === ctx.tokenOut.toLowerCase()) {
    throw bad("Swap targets a token contract directly instead of a router");
  }
  if (tx.from && tx.from.toLowerCase() !== ctx.signer.toLowerCase()) throw bad("Swap was built for a different wallet");
  if (!HEX_RE.test(tx.data) || tx.data.length < 10) throw bad("Swap calldata is empty or malformed");
  if (FORBIDDEN_SWAP_SELECTORS.has(tx.data.slice(0, 10).toLowerCase())) {
    throw bad("Swap calldata is a token approve/transfer, not a swap");
  }
}

/** The output amount the swap tx was actually built for (`routerResult.toTokenAmount`), if present. */
export function extractSwapAmountOut(data: unknown): bigint | undefined {
  const first = Array.isArray(data) ? data[0] : data;
  if (!isObj(first) || !isObj(first.routerResult)) return undefined;
  const v = intString(first.routerResult.toTokenAmount);
  return v === undefined ? undefined : BigInt(v);
}

/**
 * Binance puts its own slippage floor inside the tx (`minReceiveAmount`). It must not be
 * looser than the floor we showed the user (1 bp of rounding tolerance), otherwise the
 * confirmed "get at least X" would be a lie.
 */
export function assertMinReceive(tx: SwapTx, amountOut: bigint, slippageBps: number): void {
  if (tx.minReceive === undefined) return;
  const required = (amountOut * BigInt(Math.max(0, 10_000 - slippageBps - 1))) / 10_000n;
  if (BigInt(tx.minReceive) < required) {
    throw new SwapError("UNSAFE_TX", "The swap's own minimum output is looser than the slippage you confirmed");
  }
}

// ---------- the pair ----------

export interface PairToken {
  symbol: string;
  address: string;
  decimals: number;
}

export interface Pair {
  side: Side;
  tokenIn: PairToken;
  tokenOut: PairToken;
  /** The stock-token leg (the one that is not USDT). */
  stock: PairToken;
}

/**
 * USDT <-> a LIVE stock token. A token that is not on the live list (see token-registry.ts)
 * is refused here, so the routes, the provider and the agent guard all share one gate.
 * Anything else is refused, never guessed.
 */
export function resolvePair(tokenIn: string, tokenOut: string): Pair {
  const usdt = getTokenInfo("USDT")!;
  if (tokenIn === "USDT" && isLiveSymbol(tokenOut)) {
    const stock = getTokenInfo(tokenOut)!;
    return { side: "buy", tokenIn: usdt, tokenOut: stock, stock };
  }
  if (tokenOut === "USDT" && isLiveSymbol(tokenIn)) {
    const stock = getTokenInfo(tokenIn)!;
    return { side: "sell", tokenIn: stock, tokenOut: usdt, stock };
  }
  throw new SwapError("UNSUPPORTED_ROUTE", `Unsupported route ${tokenIn} -> ${tokenOut}`);
}
