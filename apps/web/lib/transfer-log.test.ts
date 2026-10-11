import assert from "node:assert/strict";
import test from "node:test";
import { readTransfers, recordTransfer } from "./transfer-log";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;

const A = "0x0648e8Aefd446068D36CA5446494fa912Ba51B02";

test("transfers are recorded newest first, per address, without duplicate hashes", () => {
  assert.deepEqual(readTransfers(A), []);
  recordTransfer(A, { t: 1, kind: "fund", asset: "USDT", amount: "5", txHash: "0xa" });
  const list = recordTransfer(A, { t: 2, kind: "withdraw", asset: "BNB", amount: "0.0005", txHash: "0xb" });
  assert.deepEqual(list.map((x) => x.txHash), ["0xb", "0xa"]);
  assert.equal(recordTransfer(A, { t: 3, kind: "withdraw", asset: "BNB", amount: "0.0005", txHash: "0xB" }).length, 2);
  assert.equal(readTransfers(A.toLowerCase()).length, 2, "address case does not matter");
  assert.deepEqual(readTransfers("0x1111111111111111111111111111111111111111"), []);
});

test("corrupt storage reads as empty and never throws", () => {
  store.set(`stockx.transfers.v1.${A.toLowerCase()}`, "{not json");
  assert.deepEqual(readTransfers(A), []);
  store.set(`stockx.transfers.v1.${A.toLowerCase()}`, JSON.stringify([{ t: "x" }, { t: 1, kind: "fund", asset: "USDT", amount: "1", txHash: "0xz" }]));
  assert.equal(readTransfers(A).length, 1);
});
