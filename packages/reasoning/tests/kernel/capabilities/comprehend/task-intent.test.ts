// File: tests/kernel/capabilities/comprehend/task-intent.test.ts
//
// HS-115 / Audit G-E / anti-scaffold F4+F5 — co-located tests for the
// `nominateRequiredTools` keyword-cue surface. Covers the contracts that
// `act/guard.ts` and the runner.ts seed both rely on:
//
//   - confidence ≥ 0.5 source floor (guard re-filters to ≥ 0.7)
//   - phantom-name guard: only names from `availableTools` may be emitted
//   - deterministic ordering (confidence desc, then name asc)
//   - multi-cue accumulation
//
// One integration-style test (suite tail) demonstrates the guard fallback
// path: an empty `input.requiredTools` plus a nomination in `state.meta`
// causes the guard to surface the nominated tool in its missing-tools hint.

import { describe, expect, it } from "bun:test";
import {
  nominateRequiredTools,
  type NominatedTool,
} from "../../../../src/kernel/capabilities/comprehend/task-intent.js";
import {
  duplicateGuard,
  repetitionGuard,
} from "../../../../src/kernel/capabilities/act/guard.js";
import type {
  KernelInput,
  KernelState,
} from "../../../../src/kernel/state/kernel-state.js";
import type { ToolCallSpec } from "@reactive-agents/tools";
import type { ReasoningStep } from "../../../../src/types/index.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

const calculatorTool = { name: "calculator", description: "Evaluate arithmetic expressions" };
const webSearchTool = { name: "web-search", description: "Search the web for information" };
const httpGetTool = { name: "http-get", description: "Fetch a URL via HTTP GET" };
const fileWriteTool = { name: "file-write", description: "Write a file to disk" };
const fileReadTool = { name: "file-read", description: "Read a file from disk" };
const noopTool = { name: "echo", description: "Return the input verbatim" };

// ── (a) math task + calculator available → nominated ────────────────────────

describe("nominateRequiredTools — math/compute cue", () => {
  it("nominates calculator when the task asks to compute and a calculator tool exists", () => {
    const out = nominateRequiredTools("what's 17 * 29", [calculatorTool, noopTool]);
    const names = out.map((n) => n.name);
    expect(names).toContain("calculator");
    expect(names).not.toContain("echo");
  });

  it("nominates calculator on verb cues (calculate / evaluate / solve)", () => {
    const out = nominateRequiredTools("please solve 12+7 and evaluate the result", [
      calculatorTool,
    ]);
    expect(out[0]?.name).toBe("calculator");
    expect(out[0]?.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

// ── (b) math task + no calculator available → empty (phantom-name guard) ────

describe("nominateRequiredTools — phantom-name guard", () => {
  it("returns no nominations when math cues fire but no compute tool is available", () => {
    const out = nominateRequiredTools("what's 17 * 29", [webSearchTool, fileReadTool]);
    expect(out).toEqual([]);
  });

  it("does not emit a name that is absent from availableTools (case g)", () => {
    // Strong calculator cue but only file-write is available — must not nominate.
    const out = nominateRequiredTools("calculate the sum of 5 and 12", [fileWriteTool]);
    expect(out.map((n) => n.name)).not.toContain("calculator");
    expect(out).toEqual([]);
  });
});

// ── (c) search task + web-search available → nominated ──────────────────────

describe("nominateRequiredTools — web-search cue", () => {
  it("nominates web-search when the task says 'search for X'", () => {
    const out = nominateRequiredTools("search for the latest news on quantum computing", [
      webSearchTool,
      noopTool,
    ]);
    expect(out[0]?.name).toBe("web-search");
  });

  it("nominates web-search on 'look up' cue", () => {
    const out = nominateRequiredTools("look up the capital of France", [webSearchTool]);
    expect(out.map((n) => n.name)).toContain("web-search");
  });
});

// ── (d) file-write cue → file-write tool nominated ──────────────────────────

describe("nominateRequiredTools — file-write cue", () => {
  it("nominates a file-write tool when the task says 'save to a file'", () => {
    const out = nominateRequiredTools("save the result to a file called out.txt", [
      fileWriteTool,
      fileReadTool,
    ]);
    expect(out[0]?.name).toBe("file-write");
  });

  it("nominates file-write on 'write the file' cue", () => {
    const out = nominateRequiredTools("write a file with the summary", [fileWriteTool]);
    expect(out.map((n) => n.name)).toContain("file-write");
  });
});

// ── (e) multi-cue task → multiple nominations sorted by confidence desc ─────

describe("nominateRequiredTools — multi-cue accumulation + ordering", () => {
  it("returns multiple nominations sorted by confidence descending then name asc", () => {
    // Two compute cues (calculate AND evaluate) push calculator to a higher
    // accumulated score than the single search cue.
    const out = nominateRequiredTools(
      "calculate and evaluate 13*4, then search for related papers",
      [calculatorTool, webSearchTool],
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
    const names = out.map((n) => n.name);
    expect(names).toContain("calculator");
    expect(names).toContain("web-search");
    // Calculator should not appear AFTER web-search given two compute cues.
    const calcIdx = names.indexOf("calculator");
    const wsIdx = names.indexOf("web-search");
    expect(calcIdx).toBeLessThanOrEqual(wsIdx);
    // Confidence values are non-increasing across the array.
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.confidence).toBeGreaterThanOrEqual(out[i]!.confidence);
    }
  });
});

// ── (f) ambiguous task → empty ──────────────────────────────────────────────

describe("nominateRequiredTools — ambiguous / vacuous tasks", () => {
  it("returns empty for 'do something'", () => {
    const out = nominateRequiredTools("do something", [
      calculatorTool,
      webSearchTool,
      fileWriteTool,
    ]);
    expect(out).toEqual([]);
  });

  it("returns empty for empty / whitespace tasks", () => {
    expect(nominateRequiredTools("", [calculatorTool])).toEqual([]);
    expect(nominateRequiredTools("   ", [calculatorTool])).toEqual([]);
  });

  it("returns empty when availableTools is empty", () => {
    expect(nominateRequiredTools("what's 17 * 29", [])).toEqual([]);
  });
});

// ── (h) confidence floor enforcement ────────────────────────────────────────

describe("nominateRequiredTools — confidence floor", () => {
  it("all emitted nominations have confidence ≥ 0.5", () => {
    const out = nominateRequiredTools(
      "fetch some data, search the web, and calculate a result then write a file",
      [calculatorTool, webSearchTool, httpGetTool, fileWriteTool],
    );
    expect(out.length).toBeGreaterThan(0);
    for (const n of out) {
      expect(n.confidence).toBeGreaterThanOrEqual(0.5);
      expect(n.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("every nomination carries a non-empty reason and at least one cue", () => {
    const out = nominateRequiredTools("calculate 5+5", [calculatorTool]);
    expect(out.length).toBe(1);
    const nom = out[0] as NominatedTool;
    expect(nom.reason.length).toBeGreaterThan(0);
    expect(nom.cues.length).toBeGreaterThan(0);
  });
});

// ── Guard fallback integration (HS-115 same-commit consumer evidence) ───────

describe("act/guard — nominator fallback when input.requiredTools is empty", () => {
  /** Minimal KernelState builder for guard tests. */
  function makeState(
    overrides: Partial<KernelState> & { nominated?: readonly NominatedTool[] } = {},
  ): KernelState {
    const steps: ReasoningStep[] = [
      {
        type: "action",
        content: "called web-search successfully",
        metadata: {
          toolCall: { name: "web-search", arguments: { q: "x" } },
        },
      } as unknown as ReasoningStep,
      {
        type: "observation",
        content: "ok",
        metadata: { observationResult: { success: true } },
      } as unknown as ReasoningStep,
    ];
    return {
      taskId: "t",
      strategy: "react",
      kernelType: "react",
      steps: overrides.steps ?? steps,
      toolsUsed: new Set<string>(["web-search"]),
      scratchpad: new Map(),
      iteration: 1,
      tokens: 0,
      cost: 0,
      status: "thinking",
      output: null,
      error: null,
      llmCalls: 1,
      meta: overrides.nominated
        ? { nominatedTools: overrides.nominated }
        : (overrides.meta ?? {}),
      controllerDecisionLog: [],
      messages: [],
    } as unknown as KernelState;
  }

  const baseInput: KernelInput = {
    task: "what's 17 * 29",
    // explicitly empty — nominator fallback must engage
    requiredTools: [],
  };

  it("duplicateGuard surfaces nominated tool in the next-step hint", () => {
    const nominated: NominatedTool[] = [
      { name: "calculator", confidence: 0.85, reason: "math/compute", cues: ["17 * 29"] },
    ];
    const state = makeState({ nominated });
    const dupCall: ToolCallSpec = {
      id: "call-1",
      name: "web-search",
      arguments: { q: "x" },
    } as ToolCallSpec;

    const outcome = duplicateGuard(dupCall, state, baseInput);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      // The nominated tool must appear in the missing-tools hint.
      expect(outcome.observation).toContain("calculator");
    }
  });

  it("repetitionGuard surfaces nominated tool when threshold hit and requiredTools is empty", () => {
    // Build a state with 4 prior web-search action steps to trip the repetition
    // guard. web-search is parallel-safe → default ceiling is `maxBatchSize` (4).
    const repeated: ReasoningStep[] = [];
    for (let i = 0; i < 4; i++) {
      repeated.push({
        type: "action",
        content: "search",
        metadata: { toolCall: { name: "web-search", arguments: { q: `q${i}` } } },
      } as unknown as ReasoningStep);
      repeated.push({
        type: "observation",
        content: "ok",
        metadata: { observationResult: { success: true } },
      } as unknown as ReasoningStep);
    }
    const nominated: NominatedTool[] = [
      { name: "calculator", confidence: 0.85, reason: "math/compute", cues: ["calculate"] },
    ];
    const state = makeState({ steps: repeated, nominated });
    const tc: ToolCallSpec = {
      id: "call-9",
      name: "web-search",
      arguments: { q: "again" },
    } as ToolCallSpec;

    const outcome = repetitionGuard(tc, state, baseInput);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation).toContain("calculator");
    }
  });

  it("nominator fallback yields no missing-tools when nominations are sub-threshold (< 0.7)", () => {
    // Sub-threshold nomination must NOT be treated as required.
    const nominated: NominatedTool[] = [
      { name: "calculator", confidence: 0.55, reason: "math/compute", cues: ["compute"] },
    ];
    const state = makeState({ nominated });
    const dupCall: ToolCallSpec = {
      id: "call-1",
      name: "web-search",
      arguments: { q: "x" },
    } as ToolCallSpec;

    const outcome = duplicateGuard(dupCall, state, baseInput);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      // Sub-threshold nomination must not appear as required-but-missing.
      expect(outcome.observation).not.toContain("You still need to call: calculator");
    }
  });
});
