const AAPLB_ADDRESS = "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a";
const configuredAaplbAddress = typeof process !== "undefined"
  ? (process.env.NEXT_PUBLIC_AAPLB_ADDRESS ?? AAPLB_ADDRESS)
  : AAPLB_ADDRESS;
const configuredAaplbDecimals = typeof process !== "undefined"
  ? Number(process.env.NEXT_PUBLIC_AAPLB_DECIMALS ?? 18)
  : 18;

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

export const POCKET_CONFIG: Readonly<PocketConfig> = Object.freeze({
  chainId: 56 as const,
  rpcUrl: "https://bsc-dataseed.binance.org",
  usdtAddress: "0x55d398326f99059fF775485246999027B3197955",
  aaplbAddress: configuredAaplbAddress && /^0x[0-9a-fA-F]{40}$/.test(configuredAaplbAddress)
    ? configuredAaplbAddress
    : AAPLB_ADDRESS,
  aaplbDecimals: Number.isInteger(configuredAaplbDecimals) && configuredAaplbDecimals >= 0 && configuredAaplbDecimals <= 36
    ? configuredAaplbDecimals
    : 18,
  usdtDecimals: 18,
  quoteTtlMs: 30_000,
  systemJobCapUsdt: 25,
});

export const isPocketConfigReady = POCKET_CONFIG.aaplbAddress !== null &&
  POCKET_CONFIG.aaplbDecimals !== null;