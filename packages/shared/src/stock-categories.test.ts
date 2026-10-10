import assert from "node:assert/strict";
import test from "node:test";
import { categoryOf, STOCK_CATEGORIES } from "./stock-categories";

test("looks tickers up regardless of case and spacing", () => {
  assert.equal(categoryOf("aapl"), "Technology");
  assert.equal(categoryOf(" SPY "), "ETF");
  assert.equal(categoryOf("JPM"), "Financials");
});

test("unknown tickers have no category, and every category is in the filter list", () => {
  assert.equal(categoryOf("ZZZZ"), null);
  for (const t of ["QQQ", "GOOGL", "TSLA", "LLY", "BE"]) {
    assert.ok(STOCK_CATEGORIES.includes(categoryOf(t)!));
  }
});
