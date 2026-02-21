import { Layer } from "effect";
import { EvalServiceLive } from "./services/eval-service.js";
import { DatasetServiceLive } from "./services/dataset-service.js";

/**
 * createEvalLayer — provides EvalService + DatasetService.
 * Requires: LLMService (from @reactive-agents/llm-provider)
 */
export const createEvalLayer = () =>
  Layer.merge(EvalServiceLive, DatasetServiceLive);
