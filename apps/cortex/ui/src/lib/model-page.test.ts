import { describe, expect, test } from "bun:test";
import { capabilityNote, capabilityRows, capabilityStats, runsOnModel, type ModelCapability } from "./model-page.js";
import type { RunRow } from "./runs-table.js";

const cap = (o: Partial<ModelCapability> = {}): ModelCapability => ({
  maxContextTokens: 32768,
  recommendedNumCtx: 8192,
  maxOutputTokens: 8192,
  supportsThinking: true,
  supportsVision: false,
  supportsPromptCaching: false,
  toolCallDialect: "native",
  tier: "local",
  source: "table",
  keyConfigured: null,
  ...o,
});

const run = (o: Partial<RunRow>): RunRow => ({
  runId: "r1",
  agentId: "a1",
  startedAt: 1,
  status: "completed",
  iterationCount: 1,
  tokensUsed: 0,
  cost: 0,
  hasDebrief: false,
  ...o,
});

describe("model page", () => {
  test("stat grid: context, max output, tool calls, thinking", () => {
    expect(capabilityStats(cap())).toEqual([
      { label: "Context window", value: "32,768" },
      { label: "Max output", value: "8,192" },
      { label: "Tool calls", value: "native" },
      { label: "Thinking", value: "yes" },
    ]);
    expect(capabilityRows(cap()).map((r) => r.label)).toEqual(["Working context", "Vision", "Prompt caching", "Tier"]);
  });

  test("runsOnModel keeps exact provider and model matches, newest first", () => {
    const rows = [
      run({ runId: "old", provider: "ollama", model: "q", startedAt: 1 }),
      run({ runId: "other", provider: "ollama", model: "q2", startedAt: 5 }),
      run({ runId: "new", provider: "ollama", model: "q", startedAt: 9 }),
    ];
    expect(runsOnModel(rows, "ollama", "q").map((r) => r.runId)).toEqual(["new", "old"]);
  });

  test("note says fallback values are defaults and what runs used", () => {
    const runs = [run({ tokensUsed: 1200 }), run({ runId: "r2", tokensUsed: 32800 })];
    expect(capabilityNote(cap({ source: "fallback" }), runs)).toBe(
      "Not in the shipped capability table: these are conservative defaults, not measured values. 2 recorded runs on this model; the largest used 32.8k tokens in total.",
    );
    expect(capabilityNote(cap(), [])).toBeNull();
  });
});
