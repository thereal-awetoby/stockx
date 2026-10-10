import assert from "node:assert/strict";
import test from "node:test";
import { parseKlines } from "./kline";

const candle = (t: number, o: string, h: string, l: string, c: string) => [t, o, h, l, c, "0", t + 1];

test("parses, sorts and summarises candles", () => {
  const s = parseKlines([candle(2000, "11", "13", "10", "12"), candle(1000, "10", "11", "9", "11")], "1D");
  assert.ok(s);
  assert.deepEqual(s.points.map((p) => p.t), [1000, 2000]);
  assert.equal(s.open, 10);
  assert.equal(s.close, 12);
  assert.equal(s.high, 13);
  assert.equal(s.low, 9);
  assert.equal(Math.round(s.changePct), 20);
});

test("drops bad candles and refuses thin or malformed data", () => {
  assert.equal(parseKlines(undefined, "1D"), null);
  assert.equal(parseKlines([candle(1, "1", "1", "1", "1")], "1D"), null);
  assert.equal(parseKlines([candle(1, "1", "1", "1", "x"), candle(2, "1", "1", "1", "1")], "1D"), null);
  assert.equal(parseKlines([["bad"], candle(1, "1", "2", "1", "2"), candle(2, "2", "3", "2", "3")], "1D")?.points.length, 2);
});
