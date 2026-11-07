import { describe, it, expect } from "bun:test";
import { ChatSessionConfigBody } from "../api/chat.js";
import { RunConfigBody } from "../api/runs.js";
import { AgentConfigBodyFields } from "../api/agent-config-body.js";

// ── Drift guard: the chat session body and the run launch body share one
//    agent-config fragment (`AgentConfigBodyFields`). The chat path historically
//    dropped ~12 fields (observabilityVerbosity, numCtx, memory, metaTools, fallbacks,
//    minIterations, healthCheck, …) at this schema layer, so they never reached the
//    DB. See wiki/Research/Audit-Reports-2026-06-09/cortex-agent-quality-parity-audit.md.
//    What happens after the schema (params -> builder) is pinned by build-path-parity.test.ts.

// Keys that legitimately belong to one surface only.
// - prompt/variables/variableValues: run-launch inputs, not agent config.
// - agentName: chat derives its agent name from the session (`chat-<id>` / session
//   `name`), so it is not carried as a config field.
// (outputSchemaOnParseFail was run-only until 2026-11-06; chat now forwards it.)
const RUN_ONLY = new Set(["prompt", "variables", "variableValues", "agentName"]);

// Chat-session switches with no desk-run meaning.
const CHAT_ONLY = new Set([
  "name",
  "runId",
  "enableTools",
  "streamReasoningSteps",
  "autoName",
  "environmentUpdates",
  "traceRuns",
  "seedTurns",
  "agentControl",
]);

const keysOf = (schema: { properties: Record<string, unknown> }): string[] =>
  Object.keys(schema.properties);

describe("chat ⇄ runs agent-config schema parity", () => {
  it("both bodies carry every shared agent-config field", () => {
    const shared = Object.keys(AgentConfigBodyFields);
    const chatKeys = new Set(keysOf(ChatSessionConfigBody as never));
    const runKeys = new Set(keysOf(RunConfigBody as never));
    expect(shared.filter((k) => !chatKeys.has(k))).toEqual([]);
    expect(shared.filter((k) => !runKeys.has(k))).toEqual([]);
  });

  it("every other key is a declared one-surface key", () => {
    const shared = new Set(Object.keys(AgentConfigBodyFields));
    expect(keysOf(RunConfigBody as never).filter((k) => !shared.has(k) && !RUN_ONLY.has(k))).toEqual([]);
    expect(keysOf(ChatSessionConfigBody as never).filter((k) => !shared.has(k) && !CHAT_ONLY.has(k))).toEqual([]);
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
      "retryPolicy",
      "outputSchemaOnParseFail",
    ]) {
      expect(chatKeys.has(k)).toBe(true);
    }
  });
});
