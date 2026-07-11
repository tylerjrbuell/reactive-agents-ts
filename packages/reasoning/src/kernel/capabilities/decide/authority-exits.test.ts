// Run: bun test packages/reasoning/src/kernel/capabilities/decide/authority-exits.test.ts
//
// Authority-law wave (task #51) — north-star spec 2026-07-11 §1a / §3 / §5b.
//   Piece 1  — the lexical exits (content-stability, final-answer regex) become
//              candidate-answer PROPOSALS gated by the terminal gate on a
//              contract-bearing run; contractless exits mark evidence:none.
//   Piece 2  — every terminal carries an AuthorityClass; a lexical terminal is
//              structurally impossible on an enforceable contract (piece 1).
//   Piece 3  — the gate redirect is a receipt-visible intervention.

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  TestLLMService,
  LLMService,
  type TestTurn,
} from "@reactive-agents/llm-provider";
import { reactKernel } from "../../loop/react-kernel.js";
import { runPass } from "../../loop/run-pass.js";
import type { KernelInput } from "../../state/kernel-state.js";
import {
  contentStabilityEvaluator,
  finalAnswerRegexEvaluator,
  type TerminationContext,
} from "./arbitrator.js";
import { authorityOf, isLexicalAuthority } from "./authority.js";
import { compileRunContract } from "../../contract/run-contract.js";
import { deriveInterventionsFromSteps } from "@reactive-agents/core";

// Token padding so the token-delta guard never races the mechanism under test.
const PAD =
  " The petals rest quietly on the morning grass while the season slowly turns overhead.".repeat(30);

const STABLE = "The population of France is about 68 million people." + PAD;

const baseCtx = (over: Partial<TerminationContext> = {}): TerminationContext => ({
  thought: STABLE,
  stopReason: "end_turn",
  toolRequest: null,
  iteration: 2,
  steps: [],
  priorThought: STABLE,
  toolsUsed: new Set<string>(),
  requiredTools: ["web-search"],
  allToolSchemas: [],
  redirectCount: 0,
  priorFinalAnswerAttempts: 0,
  taskDescription: "Find the current population of France",
  ...over,
});

// ── §1 (piece 1) — content-stability is a PROPOSAL, not a terminator ─────────

describe("piece 1 — contentStabilityEvaluator gates on the contract", () => {
  it("contract present + unmet requirement → REDIRECT (not exit) — MUTATION PIN", () => {
    // Mutation tripwire: revert the evaluator to a direct `exit` (spec §1a
    // "retired as terminators") and this redirect assertion goes red.
    const runContract = compileRunContract("Find the current population of France", {
      requiredTools: ["web-search"],
    });
    const verdict = contentStabilityEvaluator.evaluate(baseCtx({ runContract }));
    expect(verdict?.action).toBe("redirect");
    expect(verdict?.reason).toContain("outstanding requirements not yet satisfied");
  });

  it("contractless (no runContract) → EXIT content_stable (legacy byte-identity)", () => {
    const verdict = contentStabilityEvaluator.evaluate(baseCtx());
    expect(verdict).toEqual({
      action: "exit",
      confidence: "high",
      reason: "content_stable",
      output: STABLE,
    });
  });

  it("vacuous contract (no deterministic floor) → EXIT (no phantom gating)", () => {
    const runContract = compileRunContract("Explain photosynthesis briefly");
    const verdict = contentStabilityEvaluator.evaluate(
      baseCtx({ requiredTools: [], runContract }),
    );
    expect(verdict?.action).toBe("exit");
    expect(verdict?.reason).toBe("content_stable");
  });
});

describe("piece 1 — finalAnswerRegexEvaluator gates on the contract", () => {
  const withFA = (over: Partial<TerminationContext> = {}) =>
    baseCtx({ thought: "FINAL ANSWER: 68 million people. " + PAD, ...over });

  it("contract present + unmet requirement → REDIRECT (not exit) — MUTATION PIN", () => {
    const runContract = compileRunContract("Find the current population of France", {
      requiredTools: ["web-search"],
    });
    const verdict = finalAnswerRegexEvaluator.evaluate(withFA({ runContract }));
    expect(verdict?.action).toBe("redirect");
    expect(verdict?.reason).toContain("outstanding requirements not yet satisfied");
  });

  it("contractless → EXIT final_answer_regex (legacy byte-identity)", () => {
    const verdict = finalAnswerRegexEvaluator.evaluate(withFA());
    expect(verdict?.action).toBe("exit");
    expect(verdict?.reason).toBe("final_answer_regex");
  });
});

// ── §2 (piece 2) — the authority map ──────────────────────────────────────────

describe("piece 2 — AuthorityClass map", () => {
  it("the two piece-1 exits are LEXICAL (never final termination authority)", () => {
    expect(isLexicalAuthority("ContentStability")).toBe(true);
    expect(isLexicalAuthority("FinalAnswerRegex")).toBe(true);
  });
  it("model-grade / deterministic actors are classified", () => {
    expect(authorityOf("LLMEndTurn")).toBe("model-grade");
    expect(authorityOf("terminal-gate:coverage")).toBe("deterministic");
    expect(authorityOf("grounding-redirect")).toBe("deterministic");
  });
  it("unknown actor defaults to model-grade (conservative middle)", () => {
    expect(authorityOf("some-future-actor")).toBe("model-grade");
  });
});

// ── §3 (piece 1b) — contractless lexical exit marks evidence:none, end-to-end ─

const contractlessTextLayer = (scenario: TestTurn[]) => {
  const svc = TestLLMService(scenario);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...svc,
      capabilities: () =>
        svc.capabilities().pipe(Effect.map((c) => ({ ...c, supportsToolCalling: false }))),
    }),
  );
};

const runKernel = (input: KernelInput, layer: Layer.Layer<LLMService>, maxIterations = 6) =>
  Effect.runPromise(
    runPass(reactKernel, input, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "authority-exits",
    }).pipe(Effect.provide(layer)),
  );

describe("piece 1b — contractless lexical exit → terminal evidence:none", () => {
  it("a free-form run that exits via the final-answer regex marks evidence:none + lexical", async () => {
    const pass = await runKernel(
      // No requiredTools, no taskContract → the compiled contract has an empty
      // deterministic floor (postConditions) → contractless for authority.
      { task: "Say hello to the user in one friendly sentence." },
      // A turn-1 "FINAL ANSWER:" prefix bypasses the iteration-0 fast-path
      // (think.ts:1017 excludes it) and reaches the oracle's finalAnswerRegex
      // evaluator — the lexical exit under test.
      contractlessTextLayer([
        { text: "FINAL ANSWER: Hello there, it is lovely to meet you today!" + PAD },
      ]),
      4,
    );
    expect(pass.state.meta.terminalEvidence).toBe("none");
    expect(pass.state.meta.terminalAuthorityClass).toBe("lexical");
  });
});

// ── §4 (piece 3) — the gate redirect is a receipt-visible intervention ────────

describe("piece 3 — forced nudge yields a receipt intervention with authorityClass", () => {
  it("a contract run whose lexical proposal is redirected records an intervention step", async () => {
    const pass = await runKernel(
      { task: "Find the current population of France", requiredTools: ["web-search"] },
      contractlessTextLayer([
        { text: "The population of France is about 68 million people." + PAD },
        { text: "The population of France is about 68 million people." + PAD },
      ]),
      4,
    );

    const interventions = deriveInterventionsFromSteps(pass.state.steps);
    // Mutation tripwire: cut the `intervention` metadata at the think.ts oracle
    // redirect emitter and this goes to length 0 → red.
    expect(interventions.length).toBeGreaterThan(0);
    const nudge = interventions.find((i) => i.whatChanged.startsWith("gate-redirect"));
    expect(nudge).toBeDefined();
    expect(nudge?.authorityClass).toBeDefined();
    expect(["lexical", "model-grade", "deterministic"]).toContain(
      nudge?.authorityClass ?? "",
    );
  });
});
