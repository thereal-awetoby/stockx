import { SwapError } from "./errors";
import { TOKENS } from "./tokens";

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
 * The aggregator/swap response shape is NOT verified against the live API (we have
 * no keys in CI). Look for the tx object in the places this family of APIs puts it
 * and fail closed with BAD_SWAP_RESPONSE if nothing valid is found.
 * Run scripts/binance-swap-test.mjs with real keys and confirm which branch matches.
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
    return { to, data: calldata as Hex, value, ...(gas ? { gas } : {}) };
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
  if (!HEX_RE.test(tx.data) || tx.data.length < 10) throw bad("Swap calldata is empty or malformed");
  if (FORBIDDEN_SWAP_SELECTORS.has(tx.data.slice(0, 10).toLowerCase())) {
    throw bad("Swap calldata is a token approve/transfer, not a swap");
  }
}

// ---------- the fixed pair ----------

export interface Pair {
  side: Side;
  tokenIn: { symbol: "USDT" | "AAPLB"; address: string; decimals: number };
  tokenOut: { symbol: "USDT" | "AAPLB"; address: string; decimals: number };
}

/** Only USDT <-> AAPLB exists in v1. Anything else is refused, never guessed. */
export function resolvePair(tokenIn: string, tokenOut: string): Pair {
  if (tokenIn === "USDT" && tokenOut === "AAPLB") return { side: "buy", tokenIn: TOKENS.USDT, tokenOut: TOKENS.AAPLB };
  if (tokenIn === "AAPLB" && tokenOut === "USDT") return { side: "sell", tokenIn: TOKENS.AAPLB, tokenOut: TOKENS.USDT };
  throw new SwapError("UNSUPPORTED_ROUTE", `Unsupported route ${tokenIn} -> ${tokenOut}`);
}
