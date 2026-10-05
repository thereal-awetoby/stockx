import { describe, expect, it } from "vitest";
import { createMockProvider, createSwapHelper } from "./index";
import type { QuoteRequest } from "./index";

const diy: QuoteRequest = { tokenIn: "USDT", tokenOut: "AAPLx", amountIn: "5", spender: "main", receiver: "main" };
const agent: QuoteRequest = { ...diy, spender: "session", receiver: "session" };

describe("swap helper", () => {
  it("DIY happy path: quote -> simulate -> execute", async () => {
    const h = createSwapHelper(createMockProvider(), { actor: "user" });
    const q = await h.quote(diy);
    expect((await h.simulate(q)).ok).toBe(true);
    const r = await h.execute(q, "main");
    expect(r.receiver).toBe("main");
  });

  it("refuses execute without simulate", async () => {
    const h = createSwapHelper(createMockProvider(), { actor: "user" });
    const q = await h.quote(diy);
    await expect(h.execute(q, "main")).rejects.toMatchObject({ code: "NOT_SIMULATED" });
  });

  it("agent can never use main", async () => {
    const h = createSwapHelper(createMockProvider(), { actor: "agent" });
    await expect(h.quote(diy)).rejects.toMatchObject({ code: "AGENT_MAIN_FORBIDDEN" });
    await expect(h.quote({ ...agent, receiver: "main" })).rejects.toMatchObject({ code: "AGENT_MAIN_FORBIDDEN" });
    const q = await h.quote(agent);
    await h.simulate(q);
    await expect(h.execute(q, "main")).rejects.toMatchObject({ code: "AGENT_MAIN_FORBIDDEN" });
    expect((await h.execute(q, "session")).receiver).toBe("session");
  });

  it("never reuses an expired RFQ", async () => {
    let t = 1_000_000;
    const h = createSwapHelper(createMockProvider(), { actor: "user", now: () => t });
    const q = { ...(await h.quote({ ...diy, tokenOut: "AAPLB" })), issuedAt: t, expiresAt: t + 30_000 };
    t += 30_001;
    await expect(h.simulate(q)).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  });

  it("one quote, one send", async () => {
    const h = createSwapHelper(createMockProvider(), { actor: "user" });
    const q = await h.quote(diy);
    await h.simulate(q);
    await h.execute(q, "main");
    await expect(h.execute(q, "main")).rejects.toMatchObject({ code: "NOT_SIMULATED" });
  });
});
