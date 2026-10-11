import assert from "node:assert/strict";
import test from "node:test";
import { priceFromDynamic } from "./prices";

test("public dynamic data gives token price and a per-token reference", () => {
  assert.deepEqual(priceFromDynamic({ tokenInfo: { price: "336.21", sharesMultiplier: "1.002" }, stockInfo: { price: "335.5" } }),
    { tokenPrice: 336.21, referencePrice: 335.5 * 1.002 });
  assert.deepEqual(priceFromDynamic({ tokenInfo: { price: 100 }, stockInfo: { price: 99 } }), { tokenPrice: 100, referencePrice: 99 });
});

test("closed market: stock price is null, so the reference is null (never invented)", () => {
  assert.deepEqual(priceFromDynamic({ tokenInfo: { price: "336.21" }, stockInfo: { price: null } }), { tokenPrice: 336.21, referencePrice: null });
  assert.deepEqual(priceFromDynamic({ tokenInfo: { price: "336.21" } }), { tokenPrice: 336.21, referencePrice: null });
});

test("unusable data returns null", () => {
  for (const bad of [null, undefined, {}, { tokenInfo: {} }, { tokenInfo: { price: "" } }, { tokenInfo: { price: "abc" } }, { tokenInfo: { price: "0" } }, { tokenInfo: { price: -1 } }]) {
    assert.equal(priceFromDynamic(bad), null);
  }
});
