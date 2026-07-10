// Run: bun test packages/reasoning/src/kernel/loop/contract-gate-threading.integration.test.ts
//
// B2 check 2.5 + deliverable protection — WIRING pins (mission 2026-07-10,
// "wire it AND pin it": feedback_wire_and_verify_end_to_end).
//
// VERIFIED SEAM MAP (2026-07-10, this file is the evidence):
//   • runner.ts:355 compiles + freezes the RunContract onto state.meta.runContract.
//   • TEXT path (provider WITHOUT native tool-calling → no resolver injected,
//     runner.ts:185): think.ts's oracle TerminationContext threads
//     state.meta.runContract (think.ts ~:1550, landed 56b56c5a) →
//     llmEndTurnEvaluator → terminal-gate check 2.5 consumes REQUIREMENT
//     satisfaction instead of the tool-name diff. Pinned by tests §1 + §3.
//   • NATIVE-FC path (resolver present — every FC-capable provider): an
//     end_turn final answer terminates via arbitrate() with ArbitrationContext
//     (think.ts final_answer branch), which does NOT carry the contract; check
//     2.5 does not run there. Deliverable protection on that path is owned —
//     BY DESIGN (terminal-gate.ts:14-16) — by the unconditional PostCondition
//     spine (applyPostConditionGate): exit-success is demoted to a
//     "post-condition-steer" escalation while a derived deliverable is unmet.
//     Pinned by tests §2 + §4.
//
// Before this file, NONE of that wiring had a failing-mode test: cutting the
// think.ts threading or the spine's demotion left the whole suite green.

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  TestLLMService,
  TestLLMServiceLayer,
  LLMService,
  type TestTurn,
} from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { succeedingToolLayer } from "../../testing/tool-service-mock.js";
import type { KernelInput } from "../state/kernel-state.js";
import {
  arbitrate,
  llmEndTurnEvaluator,
  type ArbitrationContext,
  type TerminationContext,
} from "../capabilities/decide/arbitrator.js";
import { compileRunContract } from "../contract/run-contract.js";
import { deriveConditions } from "../capabilities/verify/derive-conditions.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../utils/observation-helpers.js";

// Token padding so the token-delta guard (<500 delta × 2 → early exit) never
// races the mechanism under test.
const PAD =
  " The petals rest quietly on the morning grass while the season slowly turns overhead.".repeat(30);

const FILE_WRITE_SCHEMA = {
  name: "file-write",
  description: "write content to a file",
  parameters: [
    { name: "path", type: "string", required: true },
    { name: "content", type: "string", required: true },
  ],
};

// Two literal deliverables derive from this task (scenario precondition below).
const TASK =
  "Write a haiku about spring to ./haiku.md and save a copy to ./haiku-copy.md";

const runKernel = (input: KernelInput, layer: Layer.Layer<LLMService>, maxIterations = 6) =>
  Effect.runPromise(
    runPass(reactKernel, input, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "contract-gate-threading",
    }).pipe(Effect.provide(layer)),
  );

// ── §1. TEXT path: think.ts threads the contract into the terminal gate ──────

/** TestLLMService with native tool-calling REPORTED OFF, so runner.ts:185 does
 *  not inject a resolver and think.ts takes the TEXT branch whose termination
 *  oracle carries state.meta.runContract. */
const textOnlyLayer = (scenario: TestTurn[]) => {
  const svc = TestLLMService(scenario);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...svc,
      capabilities: () =>
        svc
          .capabilities()
          .pipe(Effect.map((c) => ({ ...c, supportsToolCalling: false }))),
    }),
  );
};

describe("B2 — TEXT-path oracle threading (runner contract → think.ts → check 2.5)", () => {
  it("the task compiles BOTH artifact deliverables (scenario precondition)", () => {
    const contract = compileRunContract(TASK, {});
    const ids = contract.deliverables.map((d) => d.id);
    expect(ids).toContain("artifact:./haiku.md");
    expect(ids).toContain("artifact:./haiku-copy.md");
  });

  it("end_turn with unmet requirements → requirement-aware redirect (contract wording, names the FILE)", async () => {
    const pass = await runKernel(
      {
        task: TASK,
        // requiredTools declared → iteration-0 fast-path is disabled and the
        // oracle judges the candidate. (No tool layer: the model never grounds.)
        requiredTools: ["file-write"],
      },
      textOnlyLayer([
        { text: "Both haiku files are saved; the spring haiku task is fully complete now." + PAD },
        { text: "Everything requested has been written to disk; nothing remains to be done." + PAD },
      ]),
      4,
    );

    const redirect = pass.state.steps.find(
      (s) =>
        s.type === "observation" &&
        s.content.includes("outstanding requirements not yet satisfied"),
    );
    // Mutation tripwire: cut the `runContract` spread in think.ts's oracle
    // context and coverage reverts to the tool-name diff ("required tools not
    // used yet: file-write") — both assertions below go red.
    expect(redirect).toBeDefined();
    expect(redirect?.content).toContain("produce the file ./haiku-copy.md");
    // The pre-B2 fallback wording must not appear on a contract run.
    expect(
      pass.state.steps.some(
        (s) => s.type === "observation" && s.content.includes("required tools not used yet"),
      ),
    ).toBe(false);
    // And the ungrounded "everything is done" claim never ships as a grounded
    // answer: F1's grounded-terminal gate + the runner's §7.5 conversion land
    // the honest outcome — an abstention naming the ungrounded required tool.
    expect(pass.state.meta.terminatedBy).toBe("abstained");
  });
});

// ── §2. NATIVE-FC path: the PostCondition spine refuses the false success ────

const fcLayers = (scenario: TestTurn[]) =>
  Layer.merge(
    TestLLMServiceLayer(scenario),
    succeedingToolLayer({ written: true }, FILE_WRITE_SCHEMA.parameters),
  );

describe("deliverable protection — NATIVE-FC path (PostCondition spine, live loop)", () => {
  it("model writes 1 of 2 deliverables and claims done → the run must NOT report clean success", async () => {
    const pass = await runKernel(
      { task: TASK, availableToolSchemas: [FILE_WRITE_SCHEMA] },
      fcLayers([
        { toolCall: { name: "file-write", args: { path: "./haiku.md", content: "petals fall softly" } } },
        { text: "Both haiku files are saved; the spring haiku task is fully complete now." + PAD },
        { text: "Everything requested has been written to disk; nothing remains to be done." + PAD },
      ]),
    );
    // The spine demotes every exit-success while ./haiku-copy.md is unproduced;
    // the run ends on a harness guard, never as a clean "done" success.
    expect(pass.state.status).not.toBe("done");
  });

  it("model complies after the steer/nudge (writes the copy) → the run completes", async () => {
    const pass = await runKernel(
      { task: TASK, availableToolSchemas: [FILE_WRITE_SCHEMA] },
      fcLayers([
        { toolCall: { name: "file-write", args: { path: "./haiku.md", content: "petals fall softly" } } },
        { text: "Both haiku files are saved; the spring haiku task is fully complete now." + PAD },
        { match: "haiku-copy", toolCall: { name: "file-write", args: { path: "./haiku-copy.md", content: "petals fall softly" } } },
        { text: "Now both files truly exist on disk and the task is complete." + PAD },
      ]),
      8,
    );
    expect(pass.state.status).toBe("done");
  });
});

// ── §3. Unit pins: llmEndTurnEvaluator (check 2.5 vs tool-name fallback) ─────

const baseCtx = (over: Partial<TerminationContext> = {}): TerminationContext => ({
  thought: "The population of France is about 68 million people.",
  stopReason: "end_turn",
  toolRequest: null,
  iteration: 2,
  steps: [],
  toolsUsed: new Set<string>(),
  requiredTools: ["web-search"],
  allToolSchemas: [],
  redirectCount: 0,
  priorFinalAnswerAttempts: 0,
  taskDescription: "Find the current population of France",
  ...over,
});

describe("llmEndTurnEvaluator coverage — contract present vs absent", () => {
  it("no contract → the pre-B2 tool-name-diff redirect, byte-for-byte", () => {
    const verdict = llmEndTurnEvaluator.evaluate(baseCtx());
    expect(verdict).toEqual({
      action: "redirect",
      confidence: "medium",
      reason:
        "required tools not used yet: web-search — use them, or state explicitly why they are unnecessary and give your final answer",
    });
  });

  it("contract present → coverage names the unsatisfied REQUIREMENT, not the tool diff", () => {
    const runContract = compileRunContract("Find the current population of France", {
      requiredTools: ["web-search"],
    });
    const verdict = llmEndTurnEvaluator.evaluate(baseCtx({ runContract }));
    expect(verdict?.action).toBe("redirect");
    expect(verdict?.reason).toContain("outstanding requirements not yet satisfied");
    expect(verdict?.reason).toContain("call the `web-search` tool");
    expect(verdict?.reason).not.toContain("required tools not used yet");
  });

  it("paths diverge: tool ATTEMPTED but never successful — fallback accepts, contract redirects", () => {
    // `state.toolsUsed` is written before execution (attempted-semantics,
    // act.ts): the tool-name diff counts this as covered. The contract's
    // ToolCalled condition verifies against the LEDGER (successful
    // observations) and stays unmet. Same facts, different verdicts — the
    // proof that check 2.5 is requirement satisfaction, not a re-skinned diff.
    const attempted = { toolsUsed: new Set(["web-search"]) };

    const fallbackVerdict = llmEndTurnEvaluator.evaluate(baseCtx(attempted));
    expect(fallbackVerdict?.action).toBe("exit");
    expect(fallbackVerdict?.reason).toBe("llm_end_turn");

    const runContract = compileRunContract("Find the current population of France", {
      requiredTools: ["web-search"],
    });
    const contractVerdict = llmEndTurnEvaluator.evaluate(
      baseCtx({ ...attempted, runContract }),
    );
    expect(contractVerdict?.action).toBe("redirect");
    expect(contractVerdict?.reason).toContain("call the `web-search` tool");
  });

  it("contract with an empty deterministic floor → exit unchanged (no phantom gating)", () => {
    const runContract = compileRunContract("Explain photosynthesis briefly");
    const verdict = llmEndTurnEvaluator.evaluate(
      baseCtx({ requiredTools: [], runContract }),
    );
    expect(verdict?.action).toBe("exit");
    expect(verdict?.reason).toBe("llm_end_turn");
  });
});

// ── §4. Unit pin: the spine's demotion at the arbitrate seam ──────────────────

describe("PostCondition spine — arbitrate() refuses success while a deliverable is unmet", () => {
  const writtenSteps = (paths: readonly string[]) =>
    paths.flatMap((p, i) => [
      makeStep("action", `file-write({"path":"${p}"})`, {
        toolCall: { id: `c${i}`, name: "file-write", arguments: { path: p, content: "x" } },
      }),
      makeStep("observation", "✓ Written to file", {
        toolCallId: `c${i}`,
        observationResult: makeObservationResult("file-write", true, "written"),
      }),
    ]);

  const ctxWith = (steps: ArbitrationContext["steps"]): ArbitrationContext => ({
    iteration: 2,
    task: TASK,
    steps,
    toolsUsed: new Set(["file-write"]),
    requiredTools: [],
    postConditions: deriveConditions(TASK, []),
  });

  it("one of two deliverables missing → exit-success demoted to post-condition-steer naming the file", () => {
    const verdict = arbitrate(
      { kind: "agent-final-answer", via: "end-turn", output: "Both files are saved." },
      ctxWith(writtenSteps(["./haiku.md"])),
    );
    expect(verdict.action).toBe("escalate");
    if (verdict.action === "escalate") {
      expect(verdict.nextStrategy).toBe("post-condition-steer");
      expect(verdict.reason).toContain("write the file ./haiku-copy.md");
    }
  });

  it("all deliverables produced → exit-success passes through", () => {
    const verdict = arbitrate(
      { kind: "agent-final-answer", via: "end-turn", output: "Both files are saved." },
      ctxWith(writtenSteps(["./haiku.md", "./haiku-copy.md"])),
    );
    expect(verdict.action).toBe("exit-success");
  });
});
