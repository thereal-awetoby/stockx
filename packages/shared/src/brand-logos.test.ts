import test from "node:test";
import assert from "node:assert/strict";
import { brandLogoUrl, logoDomain, simpleIconUrl } from "./brand-logos";

test("logos are served from our own origin, tickers are case and space insensitive", () => {
  assert.equal(brandLogoUrl("AAPL"), "/api/logo?ticker=AAPL");
  assert.equal(brandLogoUrl(" nvda "), "/api/logo?ticker=NVDA");
  assert.equal(brandLogoUrl("AMAT"), "/api/logo?ticker=AMAT"); // favicon only, no simpleicons slug
});

test("a ticker with no company source gets no logo (a letter is shown), never a chain icon", () => {
  assert.equal(brandLogoUrl("CYPH"), null);
  assert.equal(brandLogoUrl(""), null);
});

test("sources", () => {
  assert.equal(simpleIconUrl("AAPL"), "https://cdn.simpleicons.org/apple");
  assert.equal(simpleIconUrl("AMAT"), null);
  assert.equal(logoDomain("AMAT"), "appliedmaterials.com");
});
