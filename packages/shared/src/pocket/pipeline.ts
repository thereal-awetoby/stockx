import type { PocketPipelineFactory, PocketPipelineSource, PocketSwapPipeline, SessionSigner } from "./types";

export function isPipelineFactory(source: PocketPipelineSource): source is PocketPipelineFactory {
  return typeof source === "function";
}

/** Returns the pipeline to run a tick with. A factory is bound to the unlocked session signer. */
export function resolvePocketPipeline(source: PocketPipelineSource, signer: SessionSigner): PocketSwapPipeline {
  return isPipelineFactory(source) ? source(signer) : source;
}
