import assert from "node:assert/strict";
import test from "node:test";
import { brandLogoUrl } from "./brand-logos";

test("returns a logo URL for known tickers, regardless of case", () => {
  assert.equal(brandLogoUrl("AAPL"), "https://cdn.simpleicons.org/apple");
  assert.equal(brandLogoUrl(" nvda "), "https://cdn.simpleicons.org/nvidia");
});

test("returns null for tickers without a neutral logo", () => {
  assert.equal(brandLogoUrl("SPY"), null);
  assert.equal(brandLogoUrl(""), null);
});
