import { erc20Abi, type PublicClient, type WalletClient } from "viem";
import type { TxRequest, WalletExecutor } from "@stockx/shared";

type Addr = `0x${string}`;

/**
 * Binds the shared Binance provider to ONE connected wallet (wagmi's wallet client).
 * The DIY buy panel passes the user's main wallet here. The agent path must build its own
 * executor from the session signer and never receive this one.
 */
export function createViemExecutor(pub: PublicClient, wallet: WalletClient): WalletExecutor {
  const account = wallet.account;
  if (!account) throw new Error("Wallet client has no account. Reconnect your wallet.");
  const address = account.address;

  const toCall = (tx: TxRequest) => ({
    account: address,
    to: tx.to as Addr,
    data: tx.data,
    value: BigInt(tx.value),
  });

  return {
    address,
    chainId: () => pub.getChainId(),
    tokenBalance: (token) =>
      pub.readContract({ address: token as Addr, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    allowance: (token, spender) =>
      pub.readContract({ address: token as Addr, abi: erc20Abi, functionName: "allowance", args: [address, spender as Addr] }),
    async dryRun(tx) {
      // eth_call surfaces the revert; estimateGas gives the units. Either throws on failure.
      await pub.call(toCall(tx));
      return pub.estimateGas(toCall(tx));
    },
    send: (tx) =>
      wallet.sendTransaction({ ...toCall(tx), chain: wallet.chain ?? null }),
    async waitForReceipt(hash) {
      const r = await pub.waitForTransactionReceipt({ hash: hash as Addr, timeout: 120_000 });
      return { status: r.status === "success" ? "success" : "reverted" };
    },
  };
}
