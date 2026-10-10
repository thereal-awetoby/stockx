const configuredAaplbAddress = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_AAPLB_ADDRESS?.trim()
  : undefined;
const configuredAaplbDecimals = typeof process !== "undefined"
  ? process.env.NEXT_PUBLIC_AAPLB_DECIMALS?.trim()
  : undefined;

export interface PocketConfig {
  chainId: 56;
  rpcUrl: string;
  usdtAddress: string;
  aaplbAddress: string | null;
  aaplbDecimals: number | null;
  usdtDecimals: number;
  quoteTtlMs: number;
  systemJobCapUsdt: number;
}

const parsedAaplbAddress = configuredAaplbAddress && /^0x[0-9a-fA-F]{40}$/.test(configuredAaplbAddress)
  ? configuredAaplbAddress
  : null;
const parsedAaplbDecimals = configuredAaplbDecimals && /^\d+$/.test(configuredAaplbDecimals)
  ? Number(configuredAaplbDecimals)
  : null;

export const POCKET_CONFIG: Readonly<PocketConfig> = Object.freeze({
  chainId: 56 as const,
  rpcUrl: "https://bsc-dataseed.binance.org",
  usdtAddress: "0x55d398326f99059fF775485246999027B3197955",
  aaplbAddress: parsedAaplbAddress,
  aaplbDecimals: Number.isInteger(parsedAaplbDecimals) && parsedAaplbDecimals !== null && parsedAaplbDecimals >= 0 && parsedAaplbDecimals <= 36
    ? parsedAaplbDecimals
    : null,
  usdtDecimals: 18,
  quoteTtlMs: 30_000,
  systemJobCapUsdt: 25,
});

export const isPocketConfigReady = POCKET_CONFIG.aaplbAddress !== null &&
  POCKET_CONFIG.aaplbDecimals !== null;

/** The agent skips a tick when the pocket holds less BNB than this. A swap costs about 0.00002 BNB. */
export const MIN_SESSION_BNB_GAS = 0.0005;