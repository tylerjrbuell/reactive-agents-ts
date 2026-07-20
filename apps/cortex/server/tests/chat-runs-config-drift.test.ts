import { describe, it, expect } from "bun:test";
import { ChatSessionConfigBody } from "../api/chat.js";
import { RunConfigBody } from "../api/runs.js";

// ── Drift guard: chat config body must cover every agent-config field the Lab
//    run body accepts (minus run-only keys). The chat path historically dropped
//    ~12 fields (observabilityVerbosity, numCtx, memory, metaTools, fallbacks,
//    minIterations, healthCheck, …) at this schema layer, so they never reached
//    the DB. See wiki/Research/Audit-Reports-2026-06-09/cortex-agent-quality-parity-audit.md.
//
// This pins parity at the cheapest layer (TypeBox property keys) without the
// shared-mapper refactor. If a new agent-config field is added to runs but not
// chat, this fails.

// Keys that legitimately belong to one surface only.
// - prompt/variables/variableValues: run-launch inputs, not agent config.
// - agentName: chat derives its agent name from the session (`chat-<id>` / session
//   `name`), so it is not carried as a config field.
// - durableRuns: durable crash-resume + HITL is a run-launch concept (Phase E);
//   chat sessions are interactive and not durably resumed.
// - outputSchema / outputSchemaOnParseFail: one-shot typed extraction of a run's
//   answer; chat is conversational, not a single structured result.
const RUN_ONLY = new Set([
  "prompt",
  "variables",
  "variableValues",
  "agentName",
  "durableRuns",
  "outputSchema",
  "outputSchemaOnParseFail",
  // budget caps + grounding + model routing are surfaced on the run launcher
  // for now; chat inherits framework defaults. (Persisted for saved agents via
  // normalize.)
  "budget",
  "grounding",
  "modelRouting",
  // rawConfig is the run-launcher's advanced framework-config override surface;
  // chat sessions use the curated fields only.
  "rawConfig",
]);

const keysOf = (schema: { properties: Record<string, unknown> }): string[] =>
  Object.keys(schema.properties);

describe("chat ⇄ runs agent-config schema parity", () => {
  it("chat session body accepts every run agent-config field (minus run-only)", () => {
    const chatKeys = new Set(keysOf(ChatSessionConfigBody as never));
    const runKeys = keysOf(RunConfigBody as never).filter((k) => !RUN_ONLY.has(k));

    const missing = runKeys.filter((k) => !chatKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("pins the specific fields that were previously dropped", () => {
    const chatKeys = new Set(keysOf(ChatSessionConfigBody as never));
    for (const k of [
      "numCtx",
      "minIterations",
      "memory",
      "metaTools",
      "fallbacks",
      "observabilityVerbosity",
      "taskContext",
      "healthCheck",
      "timeout",
      "progressCheckpoint",
      "retryPolicy",
    ]) {
      expect(chatKeys.has(k)).toBe(true);
    }
  });
});
