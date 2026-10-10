import { agentLimitsOff } from "./config";
import { MAX_AGENT_TRADE_USDT } from "./guards";

/**
 * Plain-English agent instructions, parsed by plain rules (no AI call, nothing guessed).
 * It can only ever produce what the agent already supports: a USDT -> AAPLB buy, now or daily.
 * Anything else is refused with a reason. The result is a PROPOSAL; the user still has to confirm,
 * and every pocket guard (session-only, market open, gas floor, kill switch) still applies after.
 */
export type AgentIntent =
  | { action: "buy"; amountUsdt: string; when: "now" }
  | { action: "buy"; amountUsdt: string; when: "daily"; hourUtc: number; minuteUtc: number };

export type ParseResult =
  | { ok: true; intent: AgentIntent; summary: string; notes: string[] }
  | { ok: false; reason: string };

const refuse = (reason: string): ParseResult => ({ ok: false, reason });

const MONEY_SYMBOL = /\$\s*(\d+(?:\.\d{1,6})?)/g;
const MONEY_WORD = /(\d+(?:\.\d{1,6})?)\s*(?:usdt|usd|dollars?|bucks)\b/g;
const IGNORED_CAPS = new Set(["USDT", "USD", "UTC", "AAPL", "AAPLB", "AM", "PM", "I", "OK"]);

function amounts(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(MONEY_SYMBOL)) found.add(String(Number(m[1])));
  for (const m of text.matchAll(MONEY_WORD)) found.add(String(Number(m[1])));
  return [...found];
}

function parseDailyTime(text: string): { hourUtc: number; minuteUtc: number } | "invalid" {
  const m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return { hourUtc: 15, minuteUtc: 0 }; // the agent's default daily slot
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3];
  if (meridiem) {
    if (hour < 1 || hour > 12) return "invalid";
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return "invalid";
  return { hourUtc: hour, minuteUtc: minute };
}

export function parseAgentInstruction(input: string): ParseResult {
  const original = input.trim();
  if (!original) return refuse("Type what you want, for example: buy $2 of AAPLB now.");
  if (original.length > 300) return refuse("Keep it short: one instruction, under 300 characters.");
  const text = original.toLowerCase();

  if (/\b(withdraw|send|transfer|move|main wallet|my wallet|private key|passphrase|approve)\b/.test(text)) {
    return refuse("The agent can't move funds or touch your main wallet. It only buys inside the pocket. Use Fund and Withdraw yourself.");
  }
  if (/\b(sell|take[- ]?profit|stop[- ]?loss|short|leverage|margin|close)\b/.test(text)) {
    return refuse("Selling and take-profit aren't active in this build. The agent only buys AAPLB. You can sell from the stock page with your main wallet.");
  }
  const otherTickers = (original.match(/\b[A-Z]{2,6}\b/g) ?? []).filter((t) => !IGNORED_CAPS.has(t));
  if (otherTickers.length > 0 || /\b(nvda|tsla|nvidia|tesla|bitcoin|btc|eth|bnb)\b/.test(text)) {
    return refuse("Only AAPLB (Apple) is live. Other stocks and coins aren't supported yet.");
  }
  if (!/\b(buy|purchase|get|accumulate|dca)\b/.test(text)) {
    return refuse("Say what to do. For example: buy $2 of AAPLB now, or buy $2 of AAPLB every day.");
  }

  // "...and stop after $20" is a cap, not a second buy amount. Strip it, and say it is ignored.
  const CAP_PHRASE = /\b(?:stop after|up to|at most|cap(?:ped)?(?: at| of)?|max(?:imum)?(?: of)?|limit(?: of)?)\s*(?:\$\s*)?\d+(?:\.\d{1,6})?(?:\s*(?:usdt|usd|dollars?))?/g;
  const capMentioned = CAP_PHRASE.test(text);
  const found = amounts(text.replace(CAP_PHRASE, " "));
  if (found.length === 0) return refuse("How much? Include an amount like $2 or 2 USDT.");
  if (found.length > 1) return refuse(`I found more than one amount (${found.join(", ")}). Give one amount per instruction.`);
  const amount = found[0]!;
  if (!(Number(amount) > 0)) return refuse("The amount must be above zero.");
  if (!agentLimitsOff() && Number(amount) > MAX_AGENT_TRADE_USDT) {
    return refuse(`The most the agent can buy per trade is ${MAX_AGENT_TRADE_USDT} USDT.`);
  }

  if (/\b(weekly|hourly|monthly|every (?:hour|week|month|\d+|other)|per (?:hour|week)|each (?:hour|week))\b/.test(text)) {
    return refuse("The agent only supports 'now' or 'every day'.");
  }
  const daily = /\b(every day|daily|each day|once a day|everyday)\b/.test(text);
  const now = /\b(now|right now|immediately|once|today)\b/.test(text.replace(/once a day/g, ""));
  if (daily && now) return refuse("Pick one: 'now' or 'every day'.");
  if (!daily && !now) return refuse("When? Say 'now' to buy once, or 'every day' (optionally 'at 3pm UTC').");

  const notes: string[] = [];
  if (capMentioned || /\b(cap|stop after|up to|at most|limit)\b/.test(text)) {
    notes.push("Spending caps are fixed by the app. Anything you said about a cap is ignored.");
  }
  if (!daily) {
    return { ok: true, intent: { action: "buy", amountUsdt: amount, when: "now" }, summary: `Buy ${amount} USDT of AAPLB once, right now, from the pocket.`, notes };
  }
  const time = parseDailyTime(text);
  if (time === "invalid") return refuse("I couldn't read that time. Try 'at 15:00 UTC' or 'at 3pm UTC'.");
  if (/\bat\b/.test(text) && !/\butc\b/.test(text)) notes.push("Times are read as UTC.");
  const hh = String(time.hourUtc).padStart(2, "0");
  const mm = String(time.minuteUtc).padStart(2, "0");
  notes.push("Runs only while this tab stays open.");
  return {
    ok: true,
    intent: { action: "buy", amountUsdt: amount, when: "daily", ...time },
    summary: `Buy ${amount} USDT of AAPLB every day at ${hh}:${mm} UTC from the pocket.`,
    notes,
  };
}
