import { describe, expect, it } from "vitest";
import { getUsMarketStatus } from "./market-hours";

describe("US market hours", () => {
  it("open on a weekday midday ET (EDT)", () => {
    expect(getUsMarketStatus(new Date("2026-10-07T15:00:00Z")).open).toBe(true);
  });
  it("closed Saturday, next open Monday 9:30 ET", () => {
    const s = getUsMarketStatus(new Date("2026-10-10T12:00:00Z"));
    expect(s.open).toBe(false);
    expect(s.reason).toBe("weekend");
    expect(s.nextOpen.toISOString()).toBe("2026-10-12T13:30:00.000Z");
  });
  it("closed after the bell", () => {
    const s = getUsMarketStatus(new Date("2026-10-07T21:00:00Z"));
    expect(s.open).toBe(false);
    expect(s.reason).toBe("after-close");
    expect(s.nextOpen.toISOString()).toBe("2026-10-08T13:30:00.000Z");
  });
  it("handles standard time (EST)", () => {
    const s = getUsMarketStatus(new Date("2026-12-02T15:00:00Z")); // 10:00 EST
    expect(s.open).toBe(true);
  });
  it("skips holidays", () => {
    const s = getUsMarketStatus(new Date("2026-11-26T15:00:00Z")); // Thanksgiving
    expect(s.open).toBe(false);
    expect(s.reason).toBe("holiday");
    expect(s.nextOpen.toISOString()).toBe("2026-11-27T14:30:00.000Z");
  });
});
