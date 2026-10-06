"use client";
import { useMemo, useState } from "react";
import { createMockProvider, createSwapHelper } from "@stockx/shared";

/** A0 proof: the UI can drive quote -> simulate -> execute through the shared helper. */
export default function SwapSmokeTest() {
  const helper = useMemo(() => createSwapHelper(createMockProvider(), { actor: "user" }), []);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const push = (l: string) => setLog((x) => [...x, l]);

  async function run() {
    setBusy(true);
    setLog([]);
    try {
      const q = await helper.quote({
        tokenIn: "USDT", tokenOut: "AAPLB", amountIn: "5",
        spender: "main", receiver: "main",
      });
      push(`quote ${q.id}: 5 USDT -> ${q.amountOut} AAPLB (${q.style})`);
      const sim = await helper.simulate(q);
      push(`simulate: ${sim.ok ? "ok" : "FAILED " + sim.error}`);
      if (!sim.ok) return;
      const res = await helper.execute(q, "main");
      push(`execute: ${res.txHash.slice(0, 18)}… receiver=${res.receiver}`);
    } catch (e) {
      push(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <strong>Swap helper smoke test (mock)</strong>
        <button onClick={run} disabled={busy}>{busy ? "Running…" : "Buy 5 USDT of AAPLB"}</button>
      </div>
      {log.length > 0 && <pre>{log.join("\n")}</pre>}
    </div>
  );
}
