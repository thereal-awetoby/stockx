import { agentLimitsOff } from "./config";
import { MAX_AGENT_TRADE_USDT } from "./guards";

/**
 * Plain-English agent instructions, parsed by plain rules (no AI call, nothing guessed).
 * It can only ever produce what the agent already supports: a USDT -> AAPLB buy (now or daily), or a one-off
 * AAPLB -> USDT sell of the pocket's own tokens (all of them, or a stated amount).
 * Anything else is refused with a reason. The result is a PROPOSAL; the user still has to confirm,
 * and every pocket guard (session-only, gas floor, kill switch) still applies after.
 */
export type AgentIntent =
  | { action: "buy"; amountUsdt: string; when: "now" }
  | { action: "buy"; amountUsdt: string; when: "daily"; hourUtc: number; minuteUtc: number }
  | { action: "sell"; all: true; when: "now" }
  | { action: "sell"; all: false; amount: string; when: "now" };

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

/** "sell all my AAPLB" or "sell 0.001 AAPLB". One-off, now, from the pocket's own balance. */
function parseSell(text: string): ParseResult {
  if (/\b(every|daily|each|weekly|hourly|monthly|per)\b/.test(text)) return refuse("Selling only runs once, right now. Try: sell all my AAPLB.");
  if (/\$|\b(usdt|usd|dollars?|bucks)\b/.test(text)) {
    return refuse("Sell by token amount or sell everything, not by dollar value. Try: sell 0.001 AAPLB, or sell all my AAPLB.");
  }
  const all = /\b(all|everything|entire|whole|full|max)\b/.test(text);
  const numbers = text.match(/\d+(?:\.\d+)?/g) ?? [];
  const notes = ["Sells from the pocket only. Your main wallet is never touched.", "The proceeds stay in the pocket as USDT."];
  if (all) {
    if (numbers.length > 0) return refuse("Say either 'all' or an amount, not both.");
    return { ok: true, intent: { action: "sell", all: true, when: "now" }, summary: "Sell all the AAPLB in the pocket for USDT, once, right now.", notes };
  }
  if (numbers.length === 0) return refuse("How much? Say 'sell all my AAPLB' or an amount like 'sell 0.001 AAPLB'.");
  if (numbers.length > 1) return refuse(`I found more than one amount (${numbers.join(", ")}). Give one amount per instruction.`);
  const amount = numbers[0]!;
  if (!/^\d+(?:\.\d{1,18})?$/.test(amount)) return refuse("An AAPLB amount can have at most 18 decimals.");
  if (!(Number(amount) > 0)) return refuse("The amount must be above zero.");
  return { ok: true, intent: { action: "sell", all: false, amount, when: "now" }, summary: `Sell ${amount} AAPLB from the pocket for USDT, once, right now.`, notes };
}

export function parseAgentInstruction(input: string): ParseResult {
  const original = input.trim();
  if (!original) return refuse("Type what you want, for example: buy $2 of AAPLB now.");
  if (original.length > 300) return refuse("Keep it short: one instruction, under 300 characters.");
  const text = original.toLowerCase();

  if (/\b(withdraw|send|transfer|move|main wallet|my wallet|private key|passphrase|approve)\b/.test(text)) {
    return refuse("The agent can't move funds or touch your main wallet. It only buys inside the pocket. Use Fund and Withdraw yourself.");
  }
  if (/\b(take[- ]?profit|stop[- ]?loss|short|leverage|margin|close)\b/.test(text)) {
    return refuse("Take-profit, stop-loss and leverage aren't supported. The agent can buy AAPLB, or sell what the pocket holds right now (for example: sell all my AAPLB).");
  }
  const otherTickers = (original.match(/\b[A-Z]{2,6}\b/g) ?? []).filter((t) => !IGNORED_CAPS.has(t));
  if (otherTickers.length > 0 || /\b(nvda|tsla|nvidia|tesla|bitcoin|btc|eth|bnb)\b/.test(text)) {
    return refuse("Only AAPLB (Apple) is live. Other stocks and coins aren't supported yet.");
  }
  if (/\bsell\b/.test(text)) return parseSell(text);
  if (!/\b(buy|purchase|get|accumulate|dca)\b/.test(text)) {
    return refuse("Say what to do. For example: buy $2 of AAPLB now, sell all my AAPLB, or buy $2 of AAPLB every day.");
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
