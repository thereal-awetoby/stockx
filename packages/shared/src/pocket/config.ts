const configuredAaplXAddress = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_AAPLX_ADDRESS
  : undefined;
const configuredApprovalSpender = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_SWAP_SPENDER_ADDRESS
  : undefined;
const configuredAaplXDecimals = typeof process !== "undefined"
  ? Number(process.env.NEXT_PUBLIC_AAPLX_DECIMALS)
  : Number.NaN;

export interface PocketConfig {
  chainId: 56;
  rpcUrl: string;
  usdtAddress: string;
  aaplXAddress: string | null;
  approvalSpenderAddress: string | null;
  aaplXDecimals: number | null;
  usdtDecimals: number;
  quoteTtlMs: number;
  systemJobCapUsdt: number;
}

export const POCKET_CONFIG: Readonly<PocketConfig> = Object.freeze({
  chainId: 56 as const,
  rpcUrl: "https://bsc-dataseed.binance.org",
  usdtAddress: "0x55d398326f99059fF775485246999027B3197955",
  aaplXAddress: configuredAaplXAddress && /^0x[0-9a-fA-F]{40}$/.test(configuredAaplXAddress)
    ? configuredAaplXAddress
    : null,
  approvalSpenderAddress: configuredApprovalSpender && /^0x[0-9a-fA-F]{40}$/.test(configuredApprovalSpender)
    ? configuredApprovalSpender
    : null,
  aaplXDecimals: Number.isInteger(configuredAaplXDecimals) && configuredAaplXDecimals >= 0 && configuredAaplXDecimals <= 36
    ? configuredAaplXDecimals
    : null,
  usdtDecimals: 18,
  quoteTtlMs: 30_000,
  systemJobCapUsdt: 25,
});

export const isPocketConfigReady = POCKET_CONFIG.aaplXAddress !== null &&
  POCKET_CONFIG.approvalSpenderAddress !== null &&
  POCKET_CONFIG.aaplXDecimals !== null;