import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentInstruction } from "./instruction";

process.env.NEXT_PUBLIC_AGENT_LIMITS = "on";

const ok = (s: string) => {
  const r = parseAgentInstruction(s);
  assert.equal(r.ok, true, `expected ok for: ${s}`);
  return r.ok ? r : (undefined as never);
};
const no = (s: string, re: RegExp) => {
  const r = parseAgentInstruction(s);
  assert.equal(r.ok, false, `expected refusal for: ${s}`);
  if (!r.ok) assert.match(r.reason, re);
};

test("buy once now", () => {
  for (const s of ["buy $2 of AAPLB now", "Buy 2 USDT of Apple right now", "purchase 2 dollars of AAPLB immediately", "get $2 aaplb today"]) {
    assert.deepEqual(ok(s).intent, { action: "buy", amountUsdt: "2", when: "now" });
  }
  assert.equal(ok("buy $0.43 of AAPLB now").intent.amountUsdt, "0.43");
});

test("buy daily, default and explicit UTC times", () => {
  assert.deepEqual(ok("buy $1 of AAPLB every day").intent, { action: "buy", amountUsdt: "1", when: "daily", hourUtc: 15, minuteUtc: 0 });
  assert.deepEqual(ok("buy $1 of AAPLB daily at 9:30 UTC").intent, { action: "buy", amountUsdt: "1", when: "daily", hourUtc: 9, minuteUtc: 30 });
  assert.deepEqual(ok("buy $1 of AAPLB every day at 3pm utc").intent, { action: "buy", amountUsdt: "1", when: "daily", hourUtc: 15, minuteUtc: 0 });
  assert.deepEqual(ok("buy $1 of AAPLB once a day at 12am").intent, { action: "buy", amountUsdt: "1", when: "daily", hourUtc: 0, minuteUtc: 0 });
  assert.ok(ok("buy $1 of AAPLB daily at 9").notes.some((n) => /UTC/.test(n)));
});

test("refuses anything that moves funds or touches main", () => {
  no("withdraw everything to my wallet", /can't move funds/);
  no("buy $2 AAPLB using my main wallet", /can't move funds/);
  no("send $5 to 0x123", /can't move funds/);
});

test("refuses sell, take-profit and leverage", () => {
  no("sell my AAPLB now", /Selling/);
  no("buy $2 of AAPLB and take profit at 10%", /take-profit/);
  no("buy $2 of AAPLB with 5x leverage", /Selling/);
});

test("refuses other assets", () => {
  no("buy $2 of NVDA now", /Only AAPLB/);
  no("buy $2 of tesla now", /Only AAPLB/);
  no("buy $2 of BTC now", /Only AAPLB/);
});

test("asks when something is missing or ambiguous", () => {
  no("", /Type what/);
  no("hello", /Say what to do/);
  no("buy AAPLB now", /How much/);
  no("buy $2 of AAPLB", /When\?/);
  no("buy $2 and $3 of AAPLB now", /more than one amount/);
  no("buy $2 of AAPLB now and every day", /Pick one/);
  no("buy $2 of AAPLB weekly", /only supports/);
  no("buy $2 of AAPLB every day at 25:00 utc", /couldn't read that time/);
  no("buy $0 of AAPLB now", /above zero|How much/);
  no("x".repeat(301), /under 300/);
});

test("enforces the per-trade maximum while limits are on", () => {
  no("buy $6 of AAPLB now", /most the agent can buy/);
  assert.equal(ok("buy $5 of AAPLB now").intent.amountUsdt, "5");
});

test("notes that caps in the text are ignored", () => {
  assert.ok(ok("buy $2 of AAPLB every day and stop after $20").notes.some((n) => /cap/i.test(n)));
});

test("never returns more than a buy of AAPLB", () => {
  const r = ok("buy $3 of AAPLB daily at 10:00 utc");
  assert.equal(r.intent.action, "buy");
  assert.equal(Object.keys(r.intent).sort().join(","), ["action", "amountUsdt", "hourUtc", "minuteUtc", "when"].join(","));
});
