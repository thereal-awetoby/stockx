"use client";

import { BrowserProvider } from "ethers";
import { useAccount, useWalletClient } from "wagmi";
import { PocketPanel } from "../../features/pocket/PocketPanel";
import { createBinanceProvider, createSwapHelper } from "@stockx/shared";
import { isPocketConfigReady, type MainSigner, type PocketPipelineFactory } from "@stockx/shared/pocket";
import { createSessionExecutor } from "../../lib/session-executor";

// The agent only gets a real pipeline when live swaps are on. Otherwise the mock pipeline runs.
const LIVE = process.env.NEXT_PUBLIC_LIVE_SWAPS === "1";
const livePipeline: PocketPipelineFactory = (signer) =>
  createSwapHelper(createBinanceProvider({ executor: createSessionExecutor(signer), wallet: "session" }), { actor: "agent" });

export default function PocketPage() {
  const { address = "" } = useAccount();
  const { data: walletClient } = useWalletClient();

  const getMainSigner = async (): Promise<MainSigner> => {
    if (!walletClient) throw new Error("Connect the main wallet first.");

    const provider = new BrowserProvider(walletClient.transport, {
      chainId: walletClient.chain.id,
      name: walletClient.chain.name,
    });

    return provider.getSigner(walletClient.account.address);
  };

  return (
    <main>
      <div className="lede">
        <h1>Pocket</h1>
        <p>Optional session wallet. The agent can spend only this wallet, never your main one.</p>
      </div>
      {!isPocketConfigReady && (
        <p className="warn">
          Set NEXT_PUBLIC_AAPLB_ADDRESS and NEXT_PUBLIC_AAPLB_DECIMALS in apps/web/.env.local before using live AAPLB execution.
        </p>
      )}
      <PocketPanel mainAddress={address} getMainSigner={getMainSigner} pipeline={LIVE ? livePipeline : undefined} />
    </main>
  );
}