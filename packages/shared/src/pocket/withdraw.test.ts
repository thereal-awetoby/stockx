import assert from "node:assert/strict";
import test from "node:test";
import { BNB_WITHDRAW_RESERVE_WEI, maxWithdrawable, withdrawPocketAsset } from "./wallet";

test("max BNB keeps a gas reserve; tokens are withdrawable in full", () => {
  assert.equal(maxWithdrawable("BNB", "0.00057159995"), "0.00054159995");
  assert.equal(maxWithdrawable("BNB", "0.00001"), "0.0"); // less than the reserve: nothing to send
  assert.equal(maxWithdrawable("USDT", "0.068"), "0.068");
  assert.equal(maxWithdrawable("AAPLB", "0.001277142461874045"), "0.001277142461874045");
  assert.equal(maxWithdrawable("USDT", ""), "0.0");
  assert.equal(BNB_WITHDRAW_RESERVE_WEI, 30_000_000_000_000n);
});

const ME = "0x0648e8aefd446068d36ca5446494fa912ba51b02";
const MAIN = "0x6fe5b6d32c724e2a0761c8fa49e171923d71d7ba";

function bnbSigner(opts: { balance: bigint; status?: number | null; sent?: { to?: string; value?: bigint } }) {
  return {
    getAddress: async () => ME,
    provider: { getBalance: async () => opts.balance, getFeeData: async () => ({ gasPrice: 1_000_000_000n }) },
    sendTransaction: async (tx: { to: string; value: bigint }) => {
      if (opts.sent) { opts.sent.to = tx.to; opts.sent.value = tx.value; }
      return { hash: "0xabc", wait: async () => (opts.status === null ? null : { status: opts.status ?? 1 }) };
    },
  } as never;
}

test("BNB withdrawal sends the exact value to the main wallet and returns the hash after it is mined", async () => {
  const sent: { to?: string; value?: bigint } = {};
  const hash = await withdrawPocketAsset(bnbSigner({ balance: 1_000_000_000_000_000n, sent }), ME, MAIN, "BNB", "0.0005");
  assert.equal(hash, "0xabc");
  assert.equal(sent.to, MAIN);
  assert.equal(sent.value, 500_000_000_000_000n);
});

test("refuses a BNB withdrawal that would leave no gas, a bad amount, a wrong signer and a failed receipt", async () => {
  await assert.rejects(withdrawPocketAsset(bnbSigner({ balance: 600_000_000_000_000n }), ME, MAIN, "BNB", "0.0006"), /Not enough BNB/);
  for (const bad of ["", "0", "-1", "1e-7", "abc", "1.2.3"]) {
    await assert.rejects(withdrawPocketAsset(bnbSigner({ balance: 10n ** 18n }), ME, MAIN, "BNB", bad), /valid amount/);
  }
  await assert.rejects(withdrawPocketAsset(bnbSigner({ balance: 10n ** 18n }), "0x1111111111111111111111111111111111111111", MAIN, "BNB", "0.1"), /does not match/);
  await assert.rejects(withdrawPocketAsset(bnbSigner({ balance: 10n ** 18n, status: 0 }), ME, MAIN, "BNB", "0.1"), /failed on-chain/);
  await assert.rejects(withdrawPocketAsset(bnbSigner({ balance: 10n ** 18n, status: null }), ME, MAIN, "BNB", "0.1"), /failed on-chain/);
  await assert.rejects(withdrawPocketAsset(bnbSigner({ balance: 10n ** 18n }), ME, "not-an-address", "BNB", "0.1"), /valid amount/);
});
