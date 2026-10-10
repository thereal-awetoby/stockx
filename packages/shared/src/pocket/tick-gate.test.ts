import assert from "node:assert/strict";
import test from "node:test";
import { createTickGate } from "./tick-gate";

test("only one tick runs at a time", () => {
  const gate = createTickGate();
  assert.deepEqual(gate.begin(), { ok: true });
  assert.deepEqual(gate.begin(), { ok: false, reason: "tick_in_progress" });
  gate.end("executed");
  assert.deepEqual(gate.begin(), { ok: true });
});

test("a failed or skipped tick does not block the next one", () => {
  const gate = createTickGate();
  for (const status of ["failed", "skipped", "rejected"] as const) {
    assert.deepEqual(gate.begin(), { ok: true });
    gate.end(status);
  }
  assert.equal(gate.unconfirmed, false);
});

test("execution_unknown blocks every later tick until acknowledged", () => {
  const gate = createTickGate();
  gate.begin();
  gate.end("execution_unknown");
  assert.equal(gate.unconfirmed, true);
  assert.deepEqual(gate.begin(), { ok: false, reason: "previous_tick_unconfirmed" });
  assert.deepEqual(gate.begin(), { ok: false, reason: "previous_tick_unconfirmed" });
  gate.acknowledgeUnconfirmed();
  assert.deepEqual(gate.begin(), { ok: true });
});

test("acknowledging cannot release a tick that is still running", () => {
  const gate = createTickGate();
  gate.begin();
  gate.acknowledgeUnconfirmed();
  assert.deepEqual(gate.begin(), { ok: false, reason: "tick_in_progress" });
});
