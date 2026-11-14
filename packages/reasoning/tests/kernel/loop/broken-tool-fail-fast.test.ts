// File: tests/kernel/loop/broken-tool-fail-fast.test.ts
//
// Local-model campaign 2026-11-13 (RESULTS-P2a lever 1 + the misleading-guidance
// verdict). lh-1's `web-search` failed 13-44 times per run. Three defects:
//   1. the run burned 46-47 iterations before the stall guard ended it;
//   2. the recovery redirect said "Retry web-search" after the model had already
//      switched to http-get (the route around the failing tool);
//   3. a finished run that only lacked the broken tool read as a stall/veto.
//
// Zero-token: step-level fixtures for the predicate and the guidance, one
// scripted run for the fail-fast bound. Each pin was proven load-bearing by
// cutting its fix (RED-on-cut), see the changeset.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../src/kernel/utils/observation-helpers.js";
import { GUARD_OBSERVATION_TAG } from "../../../src/kernel/state/kernel-constants.js";
import type { ReasoningStep } from "../../../src/types/index.js";
import {
  BROKEN_TOOL_STREAK,
  GIVE_UP_STREAK,
  brokenTools,
} from "../../../src/kernel/loop/runner-helpers/tool-health.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecoveryFromSteps,
} from "../../../src/kernel/loop/runner-helpers/recovery-steering.js";
import { executeReactive } from "../../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../../src/types/config.js";
import { mockToolServiceLayer } from "../../../src/testing/tool-service-mock.js";
import { provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js";
import { evidenceOf } from "../tool-evidence-fixture.js";
import { disposeExit, proposeExit } from "../../../src/kernel/loop/exit-gate.js";
import { initialKernelState, transitionState, type KernelState } from "../../../src/kernel/state/kernel-state.js";
import { modelSynthesisDeliverable } from "@reactive-agents/core";

const failed = (tool: string): ReasoningStep =>
  makeStep("observation", "Web search failed: no results", {
    observationResult: makeObservationResult(tool, false, "Web search failed: no results"),
  });
const ok = (tool: string): ReasoningStep =>
  makeStep("observation", "page body", { observationResult: makeObservationResult(tool, true, "page body") });
const repeat = (n: number, f: () => ReasoningStep): ReasoningStep[] => Array.from({ length: n }, f);

describe("tool-health: a tool is broken after a streak of failures with no success", () => {
  it("documents the thresholds", () => {
    expect(BROKEN_TOOL_STREAK).toBe(4);
    expect(GIVE_UP_STREAK).toBe(10);
  });

  it("flags the tool at the streak, not before", () => {
    expect(brokenTools(repeat(BROKEN_TOOL_STREAK - 1, () => failed("web-search")))).toEqual([]);
    expect(brokenTools(repeat(BROKEN_TOOL_STREAK, () => failed("web-search")))).toEqual([
      { toolName: "web-search", failureStreak: BROKEN_TOOL_STREAK },
    ]);
  });

  it("a success of that tool clears it; other tools' successes and guard replies do not", () => {
    const base = repeat(5, () => failed("web-search"));
    expect(brokenTools([...base, ok("web-search")])).toEqual([]);
    expect(brokenTools([...base, ok("http-get")]).map((b) => b.toolName)).toEqual(["web-search"]);
    const guardReply = makeStep("observation", "You have already called web-search 7 times", {
      observationResult: makeObservationResult("web-search", true, "x"),
      frameworkInstrumentation: GUARD_OBSERVATION_TAG,
    });
    expect(brokenTools([...base, guardReply]).map((b) => b.toolName)).toEqual(["web-search"]);
  });

  it("names the alternate that already succeeded after the failures began (routed around)", () => {
    const steps = [...repeat(3, () => failed("web-search")), ok("http-get"), failed("web-search")];
    expect(brokenTools(steps)).toEqual([{ toolName: "web-search", failureStreak: 4, routedVia: "http-get" }]);
    // A success BEFORE the streak began is not a route around it.
    const before = [ok("http-get"), ...repeat(4, () => failed("web-search"))];
    expect(brokenTools(before)[0]?.routedVia).toBeUndefined();
  });
});

describe("recovery guidance never recommends retrying a tool the run routed around", () => {
  const scan = { availableToolNames: ["web-search", "http-get", "file-write"], requiredTools: ["web-search"] };
  const guidanceFor = (steps: readonly ReasoningStep[]): string => {
    const recovery = getToolFailureRecoveryFromSteps(steps, { ...scan, evidence: evidenceOf(steps) });
    return buildRecoverySteeringGuidance(recovery, 1, 2, "stall");
  };

  it("campaign shape: web-search failed, http-get succeeded -> no 'retry web-search'", () => {
    const text = guidanceFor([...repeat(4, () => failed("web-search")), ok("http-get")]);
    expect(text).not.toMatch(/retry web-search/i);
    expect(text).toContain("web-search is unavailable");
    expect(text).toContain("results from http-get");
    expect(text).toContain("Do not call web-search again");
  });

  it("a broken tool with no route around it is named unavailable and never retried", () => {
    const text = guidanceFor(repeat(5, () => failed("web-search")));
    expect(text).toContain("web-search is unavailable");
    expect(text).not.toMatch(/retry web-search/i);
    expect(text).toContain("state that web-search was unavailable");
  });

  it("CONTROL: a tool below the streak keeps the retry-with-corrected-arguments steer", () => {
    const steps = repeat(BROKEN_TOOL_STREAK - 1, () => failed("web-search"));
    const recovery = getToolFailureRecoveryFromSteps(steps, {
      availableToolNames: ["web-search", "file-write"],
      requiredTools: ["web-search"],
      evidence: evidenceOf(steps),
    });
    expect(buildRecoverySteeringGuidance(recovery, 1, 2, "stall")).toContain("Retry web-search with corrected arguments");
  });
});

// ─── Scripted run: the fail-fast bound ────────────────────────────────────────

const SCHEMAS = [
  { name: "web-search", description: "search the web", parameters: [{ name: "q", type: "string", required: true }] },
  { name: "http-get", description: "fetch a url", parameters: [{ name: "url", type: "string", required: true }] },
];

let fetched = 0;
const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string }) =>
    req.toolName === "web-search"
      ? Effect.fail(new Error("Web search failed: Web search produced no results (only instant answers are configured)"))
      : Effect.succeed({
          success: true,
          result: { page: `fresh finding ${++fetched}: ` + Array.from({ length: 80 }, (_, k) => `fact${fetched}x${k}`).join(" ") },
        }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: name === "http-get" ? SCHEMAS[1]!.parameters : SCHEMAS[0]!.parameters }),
});

const run = (turns: Parameters<typeof TestLLMServiceLayer>[0], maxIterations: number) =>
  Effect.runPromise(
    executeReactive({
      taskDescription: "Research WASI using web-search, then summarize.",
      taskType: "research",
      memoryContext: "",
      availableTools: ["web-search", "http-get"],
      availableToolSchemas: SCHEMAS,
      requiredTools: ["web-search"],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations, maxIterationsExplicit: true },
        },
      },
      maxIterations,
    } as never).pipe(
      Effect.provide(Layer.merge(TestLLMServiceLayer(turns), toolLayer)),
      provideTestEnvelope,
    ),
  );

describe("the exit gate: an exit with only an unavailable required tool outstanding is not denied for work that cannot land", () => {
  const baseArgs = {
    kind: "soft" as const,
    outstanding: ["x"],
    hasMaterial: true,
    deniedBefore: false,
    iteration: 3,
    llmCalls: 3,
    maxIterations: 10,
  };

  it("disposeExit: unmeetable-only hands off at once, even a model proposal; otherwise it denies as before", () => {
    expect(disposeExit({ ...baseArgs, proposedBy: "model", unmeetableOnly: true })).toBe("handoff");
    expect(disposeExit({ ...baseArgs, proposedBy: "stall_deliverable", unmeetableOnly: true })).toBe("handoff");
    expect(disposeExit({ ...baseArgs, proposedBy: "stall_deliverable", unmeetableOnly: true, hasMaterial: false })).toBe("accept");
    expect(disposeExit({ ...baseArgs, proposedBy: "model" })).toBe("deny");
    expect(disposeExit({ ...baseArgs, proposedBy: "stall_deliverable" })).toBe("deny-once");
  });

  const DRAFT = "WASI is the WebAssembly System Interface, a standard for portable system calls. ".repeat(3);
  const stateAfterFailures = (n: number) =>
    transitionState(initialKernelState({ maxIterations: 20, strategy: "reactive", kernelType: "react" }), {
      status: "thinking",
      iteration: 5,
      steps: [
        makeStep("thought", DRAFT),
        ...repeat(n, () => failed("web-search")),
        ok("http-get"),
      ],
      meta: { postConditions: [{ kind: "ToolCalled", tool: "web-search" }] } as KernelState["meta"],
    });
  const propose = (n: number) =>
    Effect.runPromise(
      proposeExit({
        state: stateAfterFailures(n),
        proposal: {
          proposedBy: "stall_deliverable",
          kind: "soft",
          reason: "harness_deliverable",
          deliverable: modelSynthesisDeliverable({ type: "thought", content: DRAFT, iteration: 5 }),
        },
        input: { task: "Research WASI with web-search", requiredTools: ["web-search"] },
        maxIterations: 20,
        taskId: "t",
      }),
    );

  it("a streak past the give-up: the unavailable line replaces 'call the tool' and the exit ends (no deny-once)", async () => {
    const gated = await propose(GIVE_UP_STREAK);
    expect(gated.decision).toBe("handoff");
    const record = gated.state.steps.map((s) => s.metadata?.exitGate).find((g) => g !== undefined);
    expect(record?.outstanding).toEqual([
      `the \`web-search\` tool was unavailable (it failed ${GIVE_UP_STREAK} times in a row), so that requirement could not be met`,
    ]);
  });

  it("CONTROL: below the give-up streak the plain 'call the tool' item stands and the guard is denied once", async () => {
    const gated = await propose(GIVE_UP_STREAK - 1);
    expect(gated.decision).toBe("deny-once");
    const record = gated.state.steps.map((s) => s.metadata?.exitGate).find((g) => g !== undefined);
    expect(record?.outstanding).toEqual(["call the `web-search` tool"]);
  });
});

describe("a required tool that keeps failing ends the run honestly, in bounded iterations", () => {
  // Every turn calls web-search with a fresh query (so no duplicate-call guard
  // masks the failure), as a model that never gives up does.
  // Each turn carries real prose so the low-delta guard (token-poor turns) stays out of the way.
  const prose = (i: number): string => Array.from({ length: 450 }, (_, j) => `w${i}x${j}`).join(" ");
  // The campaign's shape: a failing web-search alongside http-get calls that keep
  // succeeding with fresh content, so no loop/stall guard ends the run first.
  const stubborn = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      text: prose(i),
      toolCalls: [
        { name: "web-search", args: { q: `wasi query ${i}` } },
        { name: "http-get", args: { url: `https://example.test/wasi/${i}` } },
      ],
    }));

  it("stops long before the iteration cap and says the tool was unavailable", async () => {
    const r = await run(stubborn(40), 40);
    const md = r.metadata as Record<string, unknown>;
    expect(r.status).toBe("failed");
    expect(md.rawTerminatedBy).toBe("required_tool_quota");
    expect(r.error ?? "").toContain("web-search");
    expect(r.error ?? "").toMatch(/unavailable/i);
    const steps = (r.steps ?? []) as readonly ReasoningStep[];
    const failures = steps.filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "web-search" && s.metadata.observationResult.success === false,
    ).length;
    // Gives up at the streak (plus, at most, the one iteration's parallel calls).
    expect(failures).toBeGreaterThanOrEqual(GIVE_UP_STREAK);
    expect(failures).toBeLessThanOrEqual(GIVE_UP_STREAK + 2);
  });

  it("CONTROL: a required tool failing below the streak does not end the run", async () => {
    const turns = [
      ...stubborn(GIVE_UP_STREAK - 2),
      { text: "FINAL ANSWER: WASI is the WebAssembly System Interface." },
    ];
    const r = await run(turns, 40);
    const md = r.metadata as Record<string, unknown>;
    expect(md.rawTerminatedBy).not.toBe("required_tool_quota");
  });
});
