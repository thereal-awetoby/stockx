import assert from "node:assert/strict";
import test from "node:test";
import { formatBalance, fractionOfBalance } from "./amount";

const e18 = (s: string) => BigInt(Math.round(Number(s) * 1e6)) * 10n ** 12n;

test("25 / 50 / Max of a USDT balance", () => {
  const b = e18("0.483");
  assert.equal(fractionOfBalance(b, 18, 25), "0.12075");
  assert.equal(fractionOfBalance(b, 18, 50), "0.2415");
  assert.equal(fractionOfBalance(b, 18, 100), "0.483");
});

test("rounds down so it never exceeds the balance", () => {
  assert.equal(fractionOfBalance(10n ** 18n / 3n, 18, 100, 6), "0.333333");
  assert.equal(fractionOfBalance(5n * 10n ** 17n + 123n, 18, 100, 4), "0.5");
});

test("tiny stock balances keep enough decimals, zero stays zero", () => {
  assert.equal(fractionOfBalance(53_995_027_135_121n, 18, 100, 8), "0.00005399");
  assert.equal(fractionOfBalance(0n, 18, 100), "0");
  assert.equal(fractionOfBalance(10n ** 18n, 18, 0), "0");
});

test("cap limits Max (the demo's largest buy)", () => {
  assert.equal(fractionOfBalance(120n * 10n ** 18n, 18, 100, 6, 50), "50");
  assert.equal(fractionOfBalance(20n * 10n ** 18n, 18, 100, 6, 50), "20");
  assert.equal(fractionOfBalance(120n * 10n ** 18n, 18, 50, 6, 50), "50");
});

test("formatBalance cuts to the given decimals with no ellipsis", () => {
  assert.equal(formatBalance("0.00057159995", 5), "0.00057");
  assert.equal(formatBalance("0.068", 4), "0.068");
  assert.equal(formatBalance("0.001277142461874045", 6), "0.001277");
  assert.equal(formatBalance("12345.6789", 2), "12,345.67");
  assert.equal(formatBalance("5", 4), "5");
  assert.equal(formatBalance("0.000004", 5), "<0.00001");
  assert.equal(formatBalance("0", 5), "0");
  assert.equal(formatBalance("abc", 5), "0");
});
