import { formatUnits, parseUnits } from "viem";

/**
 * `pct` percent of a balance as a decimal string, rounded DOWN to `dp` decimals so it never exceeds what
 * the wallet holds. `cap` (in whole units) limits the result, e.g. the demo's largest allowed buy.
 */
export function fractionOfBalance(balance: bigint, decimals: number, pct: number, dp = 6, cap?: number): string {
  if (balance <= 0n || !(pct > 0)) return "0";
  let part = (balance * BigInt(Math.round(Math.min(pct, 100) * 100))) / 10_000n;
  if (cap !== undefined) {
    const capRaw = parseUnits(String(cap), decimals);
    if (part > capRaw) part = capRaw;
  }
  const [whole = "0", frac = ""] = formatUnits(part, decimals).split(".");
  const cut = frac.slice(0, dp).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

/** Shows a balance with at most `dp` decimals, cut (not rounded up), no trailing zeros, never "…". */
export function formatBalance(value: string | number, dp: number): string {
  const text = typeof value === "number" ? value.toFixed(Math.min(dp + 4, 20)) : value;
  if (!/^\d+(\.\d+)?$/.test(text)) return "0";
  const [whole = "0", frac = ""] = text.split(".");
  const cut = frac.slice(0, dp).replace(/0+$/, "");
  if (!cut && Number(text) > 0 && whole === "0") return `<${(10 ** -dp).toFixed(dp)}`;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cut ? `${grouped}.${cut}` : grouped;
}

/** Fixed-width display: always exactly `dp` decimals, cut (never rounded up), e.g. 0.00047 or 0.06800. Dust shows as <0.00001. */
export function formatFixed(value: string | number, dp: number): string {
  const text = typeof value === "number" ? value.toFixed(Math.min(dp + 4, 20)) : value;
  if (!/^\d+(\.\d+)?$/.test(text)) return (0).toFixed(dp);
  const [whole = "0", frac = ""] = text.split(".");
  const cut = frac.padEnd(dp, "0").slice(0, dp);
  if (/^0*$/.test(whole) && /^0*$/.test(cut) && Number(text) > 0) return `<${(10 ** -dp).toFixed(dp)}`;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dp > 0 ? `${grouped}.${cut}` : grouped;
}
