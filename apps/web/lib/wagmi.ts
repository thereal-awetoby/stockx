import { createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";

export const bsc = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { decimals: 18, name: "BNB", symbol: "BNB" },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed.binance.org"],
    },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
} as const;

/**
 * BNB Chain and Ethereum mainnet.
 * No connectors are listed on purpose: wagmi auto-discovers every installed
 * browser wallet via EIP-6963 (Binance Wallet, MetaMask, Rabby, OKX...).
 * Importing from "wagmi/connectors" drags in every vendor SDK and breaks the build.
 */
export const wagmiConfig = createConfig({
  chains: [bsc, mainnet],
  connectors: [],
  multiInjectedProviderDiscovery: true,
  transports: {
    [bsc.id]: http(process.env.NEXT_PUBLIC_BSC_RPC_URL || undefined),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_ETH_RPC_URL || undefined),
  },
  ssr: true,
});