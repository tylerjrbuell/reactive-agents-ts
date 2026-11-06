// Run: bun test packages/reasoning/tests/kernel/seam-terminal-pipeline.test.ts --timeout 20000
//
// One terminal path (Plan 9 Phase 2, one completion authority).
//
// Pins:
//   (a) runner.ts reaches the post-loop terminal steps ONLY through
//       `runKernelTerminalPipeline` (one call, no direct gate imports), and no
//       other src file calls the terminal gates — terminal-pipeline.ts owns them;
//   (b) the step order is the documented order;
//   (c) every deliverable render is the shared `runTerminalSynthesis` call: no
//       other src file issues a generous synthesize call directly;
//   (d) `runTerminalSynthesis` contract: generous synthesize at 0.2, thinking-
//       safe content, spend reported, provider error → empty with zero spend.
//
// RED-ON-CUT (shown during the mission, then restored):
//   - call `runOutputQualityGate(` directly from runner.ts → (a) fails;
//   - swap two entries in KERNEL_TERMINAL_STEPS → (b) fails;
//   - inline a `budgetClass: "generous"` gatewayComplete in pace-terminal.ts → (c) fails;
//   - drop `extractThinkingSafeContent` in terminal-synthesis.ts → (d) fails.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { LLMError, LLMService, TestLLMService, type TestTurn } from "@reactive-agents/llm-provider";
import type { CompletionRequest } from "@reactive-agents/llm-provider";
import { KERNEL_TERMINAL_STEPS, terminalFences } from "../../src/kernel/loop/terminal-pipeline.js";
import { runTerminalSynthesis } from "../../src/kernel/loop/terminal-synthesis.js";
import { initialKernelState, type KernelState } from "../../src/kernel/state/kernel-state.js";

const SRC = join(import.meta.dir, "../../src");

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** Source with line and block comments removed (prose may name the calls). */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FILES = srcFiles(SRC).map((p) => ({ rel: relative(SRC, p), src: code(p) }));

describe("terminal pipeline — one entry", () => {
  it("(a) runner.ts calls only the pipeline; only the pipeline calls the gates", () => {
    const runner = FILES.find((f) => f.rel === "kernel/loop/runner.ts")!.src;
    expect(runner.match(/runKernelTerminalPipeline\(/g)?.length).toBe(1);
    for (const gate of [
      "runTerminalVerifierGate",
      "runOutputQualityGate",
      "emitTerminalDecision",
      "applyRequiredToolsFinalCheck",
      "applyNonFinalAnswerDeliverable",
      "applyOutputOwnershipCluster",
      "proposeCapExit",
    ]) {
      const callers = FILES.filter(
        (f) => new RegExp(`\\b${gate}\\(`).test(f.src) && !new RegExp(`export function ${gate}\\(`).test(f.src),
      ).map((f) => f.rel);
      expect({ gate, callers }).toEqual({ gate, callers: ["kernel/loop/terminal-pipeline.ts"] });
    }
  });

  it("(b) steps run in the documented order", () => {
    expect([...KERNEL_TERMINAL_STEPS]).toEqual([
      "complete-hooks",
      "cap-exit-proposal",
      "required-tools",
      "non-final-answer-deliverable",
      "output-ownership",
      "verify-gate",
      "quality-gate",
      "terminal-decision",
    ]);
  });

  it("fences are read off terminatedBy", () => {
    const base = initialKernelState({ maxIterations: 1, strategy: "reactive", kernelType: "react" });
    const at = (terminatedBy: string): KernelState => ({ ...base, meta: { ...base.meta, terminatedBy } });
    expect(terminalFences(at("budget_terminal"))).toEqual({
      isAwaitingApproval: false,
      isAwaitingInteraction: false,
      isAbstained: false,
      isBudgetTerminal: true,
    });
    expect(terminalFences(at("awaiting-approval")).isAwaitingApproval).toBe(true);
    expect(terminalFences(at("awaiting-interaction")).isAwaitingInteraction).toBe(true);
    expect(terminalFences(at("abstained")).isAbstained).toBe(true);
    expect(Object.values(terminalFences(at("final_answer"))).some(Boolean)).toBe(false);
  });
});

describe("terminal synthesis — one call", () => {
  it("(c) no src file but terminal-synthesis.ts issues a generous synthesize call", () => {
    const offenders = FILES.filter((f) => /budgetClass:\s*"generous"/.test(f.src)).map((f) => f.rel);
    expect(offenders).toEqual(["kernel/loop/terminal-synthesis.ts"]);
  });

  const run = (turns: TestTurn[], providerFails = false) => {
    const seen: CompletionRequest[] = [];
    const base = TestLLMService(turns);
    const spy = LLMService.of({
      ...base,
      complete: (req) => {
        seen.push(req);
        return providerFails
          ? Effect.fail(new LLMError({ message: "provider down", provider: "anthropic" }))
          : base.complete(req);
      },
    });
    const program = Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* runTerminalSynthesis(llm, { prompt: "render it", traceContext: { taskId: "t1", iteration: 2 } });
    }).pipe(Effect.provide(Layer.succeed(LLMService, spy)));
    return Effect.runPromise(program).then((r) => ({ r, seen }));
  };

  it("(d) thinking-safe content, generous synthesize request, spend reported", async () => {
    const { r, seen } = await run([{ text: "<think>scratch work</think>The answer is 42." }]);
    expect(r.content).toBe("The answer is 42.");
    expect(r.content).not.toContain("<think>");
    expect(r.tokens).toBeGreaterThan(0);
    expect(seen.length).toBe(1);
    expect(seen[0]!.purpose).toBe("synthesize");
    expect(seen[0]!.temperature).toBe(0.2);
    expect(seen[0]!.messages).toEqual([{ role: "user", content: "render it" }]);
  });

  it("(d) provider error → empty content, zero spend, never fails", async () => {
    const { r } = await run([{ text: "unused" }], true);
    expect(r).toEqual({ content: "", tokens: 0, cost: 0 });
  });
});
