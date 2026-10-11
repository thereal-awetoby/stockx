import assert from "node:assert/strict";
import test from "node:test";
import { parseKlines } from "./kline";

const candle = (t: number, o: string, h: string, l: string, c: string) => [t, o, h, l, c, "0", t + 1];

test("parses, sorts and summarises candles", () => {
  const s = parseKlines([candle(2000, "11", "13", "10", "12"), candle(1000, "10", "11", "9", "11")], "1D", 3000);
  assert.ok(s);
  assert.deepEqual(s.points.map((p) => p.t), [1000, 2000]);
  assert.equal(s.open, 10);
  assert.equal(s.close, 12);
  assert.equal(s.high, 13);
  assert.equal(s.low, 9);
  assert.equal(Math.round(s.changePct), 20);
});

test("drops bad candles and refuses thin or malformed data", () => {
  assert.equal(parseKlines(undefined, "1D", 3000), null);
  assert.equal(parseKlines([candle(1, "1", "1", "1", "1")], "1D", 3000), null);
  assert.equal(parseKlines([candle(1, "1", "1", "1", "x"), candle(2, "1", "1", "1", "1")], "1D", 3000), null);
  assert.equal(parseKlines([["bad"], candle(1, "1", "2", "1", "2"), candle(2, "2", "3", "2", "3")], "1D", 3000)?.points.length, 2);
});

const H = 3_600_000;

test("1D only uses candles from the last 24 hours, even when the API returns older ones (thin tokens)", () => {
  const now = 100 * 24 * H;
  const raw = [
    candle(now - 9 * 24 * H, "100", "100", "100", "100"), // 9 days old: must not count
    candle(now - 30 * H, "100", "100", "100", "100"),
    candle(now - 20 * H, "50", "52", "49", "51"),
    candle(now - 1 * H, "51", "55", "51", "54"),
  ];
  const s = parseKlines(raw, "1D", now)!;
  assert.equal(s.points.length, 2);
  assert.equal(s.open, 50);
  assert.equal(s.close, 54);
  assert.equal(Math.round(s.changePct), 8);
});

test("no change or chart when fewer than two candles fall inside the window", () => {
  const now = 100 * 24 * H;
  assert.equal(parseKlines([candle(now - 5 * 24 * H, "1", "1", "1", "1"), candle(now - 4 * 24 * H, "1", "2", "1", "2"), candle(now - 2 * H, "2", "2", "2", "2")], "1D", now), null);
});

test("wider ranges keep their own windows and ALL keeps everything", () => {
  const now = 400 * 24 * H;
  const raw = [candle(now - 200 * 24 * H, "1", "1", "1", "1"), candle(now - 20 * 24 * H, "2", "2", "2", "2"), candle(now - 2 * 24 * H, "3", "3", "3", "3")];
  assert.equal(parseKlines(raw, "1W", now), null);
  assert.equal(parseKlines(raw, "1M", now)!.points.length, 2);
  assert.equal(parseKlines(raw, "3M", now)!.points.length, 2);
  assert.equal(parseKlines(raw, "ALL", now)!.points.length, 3);
});
