import { Effect } from "effect";
import type { LayerResult } from "../types.js";

/**
 * Multi-Source Layer (Tier 1: Placeholder)
 *
 * In Tier 2, this cross-references claims against multiple sources.
 * In Tier 1, returns moderate confidence as a placeholder.
 */
export const checkMultiSource = (
  _text: string,
): Effect.Effect<LayerResult, never> =>
  Effect.succeed({
    layerName: "multi-source",
    score: 0.6,
    passed: true,
    details: "Tier 1 placeholder — multi-source verification requires Tier 2",
  });
