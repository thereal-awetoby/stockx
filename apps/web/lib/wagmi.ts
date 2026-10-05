import { createConfig, http } from "wagmi";
import { bsc } from "wagmi/chains";

/**
 * BSC mainnet only.
 * No connectors are listed on purpose: wagmi auto-discovers every installed
 * browser wallet via EIP-6963 (Binance Wallet, MetaMask, Rabby, OKX...).
 * Importing from "wagmi/connectors" drags in every vendor SDK and breaks the build.
 */
export const wagmiConfig = createConfig({
  chains: [bsc],
  connectors: [],
  multiInjectedProviderDiscovery: true,
  transports: {
    [bsc.id]: http(process.env.NEXT_PUBLIC_BSC_RPC_URL || undefined),
  },
  ssr: true,
});