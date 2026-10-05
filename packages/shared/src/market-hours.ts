/**
 * US equity market hours (NYSE/Nasdaq regular session: Mon-Fri 9:30-16:00 ET).
 * Hardcoded holidays: VERIFY against the NYSE calendar before launch.
 * Early closes (1pm) are ignored in v1.
 */
const TZ = "America/New_York";

const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

interface EtParts { y: number; m: number; d: number; hh: number; mm: number; weekday: number }

function etParts(date: Date): EtParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
  return { y: +p.year!, m: +p.month!, d: +p.day!, hh: +p.hour!, mm: +p.minute!, weekday: wd };
}

const key = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function isTradingDay(y: number, m: number, d: number, weekday: number) {
  return weekday >= 1 && weekday <= 5 && !HOLIDAYS.has(key(y, m, d));
}

/** Convert an ET wall-clock time to a real instant. */
function etToDate(y: number, m: number, d: number, hh: number, mm: number): Date {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = etParts(new Date(guess));
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess -= asUtc - Date.UTC(y, m - 1, d, hh, mm);
  }
  return new Date(guess);
}

export interface MarketStatus {
  open: boolean;
  /** Next regular-session open (instant). Always set. */
  nextOpen: Date;
  /** Closes at (only when open). */
  closesAt?: Date;
  label: "Open" | "Closed";
  reason?: "weekend" | "holiday" | "before-open" | "after-close";
}

export function getUsMarketStatus(now: Date = new Date()): MarketStatus {
  const p = etParts(now);
  const minutes = p.hh * 60 + p.mm;
  const trading = isTradingDay(p.y, p.m, p.d, p.weekday);

  if (trading && minutes >= OPEN_MIN && minutes < CLOSE_MIN) {
    return {
      open: true,
      label: "Open",
      closesAt: etToDate(p.y, p.m, p.d, 16, 0),
      nextOpen: nextOpenAfter(now, true),
    };
  }

  let reason: MarketStatus["reason"];
  if (p.weekday === 0 || p.weekday === 6) reason = "weekend";
  else if (!trading) reason = "holiday";
  else if (minutes < OPEN_MIN) reason = "before-open";
  else reason = "after-close";

  return { open: false, label: "Closed", reason, nextOpen: nextOpenAfter(now, false) };
}

function nextOpenAfter(now: Date, skipToday: boolean): Date {
  const base = etParts(now);
  for (let i = 0; i < 14; i++) {
    // Walk ET calendar days using noon UTC anchors to avoid DST edges.
    const anchor = new Date(Date.UTC(base.y, base.m - 1, base.d + i, 12, 0));
    const p = etParts(anchor);
    if (!isTradingDay(p.y, p.m, p.d, p.weekday)) continue;
    const openAt = etToDate(p.y, p.m, p.d, 9, 30);
    if (openAt.getTime() > now.getTime() && !(skipToday && i === 0)) return openAt;
  }
  throw new Error("No trading day found in 14 days");
}
