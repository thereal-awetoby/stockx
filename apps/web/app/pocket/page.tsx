"use client";

import { BrowserProvider } from "ethers";
import { useAccount, useWalletClient } from "wagmi";
import { PocketPanel } from "../../features/pocket/PocketPanel";
import { isPocketConfigReady, type MainSigner } from "@stockx/shared/pocket";

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
      <PocketPanel mainAddress={address} getMainSigner={getMainSigner} />
    </main>
  );
}