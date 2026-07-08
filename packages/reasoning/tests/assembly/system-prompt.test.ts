import { describe, it, expect } from "bun:test";
import { systemPromptStage } from "../../src/assembly/stages/system-prompt.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

it("renders persona + goal + remaining post-conditions", () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  const log = new EventLog().append({ kind: "goal", text: "fetch and write" }).append({ kind: "goal_state", remaining: ["write_file"] });
  const c = systemPromptStage({ log, capability: cap, store: new ResultStore(), persona: { system: "You are an agent." }, tools: { schemas: [] }, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(cap) });
  expect(c.systemPrompt).toContain("You are an agent.");
  expect(c.systemPrompt).toContain("fetch and write");
  expect(c.systemPrompt).toContain("write_file");
});

it("Environment block + persona when no goal/goal_state events", () => {
  // The Environment block (date/time/timezone/platform) is ALWAYS injected — ported
  // from legacy buildStaticContext so project() doesn't drop temporal grounding
  // (date-hallucination regression). Persona follows; no goal/remaining sections here.
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  const c = systemPromptStage({ log: new EventLog(), capability: cap, store: new ResultStore(), persona: { system: "Base." }, tools: { schemas: [] }, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(cap) });
  expect(c.systemPrompt).toContain("Environment:");
  expect(c.systemPrompt).toContain("Date:");
  expect(c.systemPrompt).toContain("Base.");
  expect(c.systemPrompt).not.toContain("Goal:");
});

// ── H1 (2026-07-08 sweep, audit 03-F1): priorContext must RENDER ──────────────
// Composed by every strategy (switch handoffs, ToT approach, reflexion hints,
// memory bootstrap) but write-only since the APC deletion removed its renderer.
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";

function makeH1State(task: string): KernelState {
  return {
    taskId: "h1-task",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set(),
    scratchpad: new Map(),
    iteration: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {},
    controllerDecisionLog: [],
    messages: [{ role: "user", content: task }],
  } as KernelState;
}

const H1_PROFILE = { maxTokens: 32_768, tier: "mid" } as never;

describe("H1 — priorContext renders into the system prompt", () => {
  it("renders a fenced prior-context block when supplied", () => {
    const state = makeH1State("summarize the findings");
    const { request } = project(
      fromKernelState(state, H1_PROFILE, { system: "" }, { schemas: [] }, "summarize the findings",
        "HANDOFF: web-search already succeeded; key fact: X is 42."),
    );
    expect(request.systemPrompt).toContain("Prior context (from earlier work on this task):");
    expect(request.systemPrompt).toContain("key fact: X is 42");
  });

  it("no block when priorContext absent or blank", () => {
    const state = makeH1State("task");
    const { request } = project(
      fromKernelState(state, H1_PROFILE, { system: "" }, { schemas: [] }, "task", "   "),
    );
    expect(request.systemPrompt).not.toContain("Prior context");
  });
});
