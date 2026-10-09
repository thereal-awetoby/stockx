import assert from "node:assert/strict";
import test from "node:test";
import { isPipelineFactory, resolvePocketPipeline } from "./pipeline";
import type { PocketSwapPipeline, SessionSigner } from "./types";

const pipeline = { quote: async () => { throw new Error("x"); }, simulate: async () => { throw new Error("x"); }, execute: async () => { throw new Error("x"); } } as PocketSwapPipeline;
const signer = { getAddress: async () => "0x0" } as unknown as SessionSigner;

test("a plain pipeline is returned as is", () => {
  assert.equal(isPipelineFactory(pipeline), false);
  assert.equal(resolvePocketPipeline(pipeline, signer), pipeline);
});

test("a factory is bound to the unlocked session signer", () => {
  let received: SessionSigner | null = null;
  const built = resolvePocketPipeline((s) => { received = s; return pipeline; }, signer);
  assert.equal(received, signer);
  assert.equal(built, pipeline);
});
