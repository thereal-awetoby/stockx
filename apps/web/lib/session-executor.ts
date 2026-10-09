import { Contract, type Wallet } from "ethers";
import type { TxRequest, WalletExecutor } from "@stockx/shared";

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

/**
 * Binds the shared Binance provider to the unlocked SESSION wallet (ethers Wallet from unlockPocket,
 * already connected to a JSON-RPC provider). The agent path uses only this executor. It never
 * receives the main wallet's signer, and the provider refuses any wallet other than "session".
 */
export function createSessionExecutor(signer: Wallet): WalletExecutor {
  const provider = signer.provider;
  if (!provider) throw new Error("Session signer has no provider.");
  const address = signer.address;

  const call = (tx: TxRequest) => ({ from: address, to: tx.to, data: tx.data, value: BigInt(tx.value) });

  return {
    address,
    chainId: async () => Number((await provider.getNetwork()).chainId),
    tokenBalance: async (token) => (await new Contract(token, ERC20, provider).getFunction("balanceOf")(address)) as bigint,
    allowance: async (token, spender) =>
      (await new Contract(token, ERC20, provider).getFunction("allowance")(address, spender)) as bigint,
    async dryRun(tx) {
      await provider.call(call(tx)); // throws with the revert reason if the swap would fail
      return provider.estimateGas(call(tx));
    },
    async send(tx) {
      const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value), chainId: 56 });
      return sent.hash;
    },
    async waitForReceipt(hash) {
      const receipt = await provider.waitForTransaction(hash, 1, 120_000);
      if (!receipt) throw new Error("Timed out waiting for the receipt.");
      return { status: receipt.status === 1 ? "success" : "reverted" };
    },
  };
}
