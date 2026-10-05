/** (onchain - reference) / reference, as a percent. Null if reference is unusable. */
export function calcPremiumPct(onchain: number, reference: number): number | null {
  if (!Number.isFinite(onchain) || !Number.isFinite(reference) || reference <= 0) return null;
  return ((onchain - reference) / reference) * 100;
}
