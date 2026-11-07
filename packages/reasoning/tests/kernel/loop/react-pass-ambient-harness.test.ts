/**
 * react-pass-ambient-harness.test.ts — a ReAct pass built by `prepareReActPass`
 * runs with the RUN's resolved harness (`.withHarness(...)`) when its input
 * carries none.
 *
 * Defect (found 2026-11-06): the pass envelope `prepareReActPass` builds from
 * its input always resolves a harness (env + defaults), and the merge filled
 * `kernelInput.harness` with it. A plan-execute step input never carries a
 * harness, so every `.withHarness` field was silently ignored inside steps:
 * `runKernel`'s ambient merge only fills holes, and there was no hole left.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { prepareReActPass } from "../../../src/kernel/loop/react-kernel.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js";
import { resolveHarnessConfig } from "../../../src/harness-config.js";
import { executePlanExecute } from "../../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../../src/types/config.js";

describe("prepareReActPass — ambient run harness", () => {
  it("uses the run envelope's harness when the input has none", async () => {
    const env = buildRunEnvelope({ harness: { actOrAnswer: "proactive" } });
    const { kernelInput } = await Effect.runPromise(
      provideTestEnvelope(prepareReActPass({ task: "t" }), env),
    );
    expect(kernelInput.harness?.actOrAnswer).toBe("proactive");
    expect(kernelInput.harness).toBe(env.harness);
  });

  it("an explicit input harness still wins over the run envelope", async () => {
    const env = buildRunEnvelope({ harness: { actOrAnswer: "proactive" } });
    const own = resolveHarnessConfig({ actOrAnswer: false });
    const { kernelInput } = await Effect.runPromise(
      provideTestEnvelope(prepareReActPass({ task: "t", harness: own }), env),
    );
    expect(kernelInput.harness?.actOrAnswer).toBe(false);
  });

  it("with no run envelope in context, the pass resolves env + defaults as before", async () => {
    const { kernelInput } = await Effect.runPromise(prepareReActPass({ task: "t" }));
    expect(kernelInput.harness).toEqual(resolveHarnessConfig());
  });
});

describe("plan-execute step kernel sees the run's .withHarness config", () => {
  const dir = mkdtempSync(join(tmpdir(), "ra-step-harness-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a harness field set on the run reaches the step kernel's think", async () => {
    // promptDumpPathPrefix is observable from outside: only a kernel think that
    // carries it writes a dump. Steps are the only kernel passes in this plan.
    const env = buildRunEnvelope({ harness: { promptDumpPathPrefix: join(dir, "dump") } });
    const plan = JSON.stringify({
      // composite = a ReAct sub-kernel pass (analysis is a direct, kernel-less call).
      steps: [{ title: "Answer", instruction: "answer the question", type: "composite" }],
    });
    const llm = TestLLMServiceLayer([
      { match: "planning agent", text: plan },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: 42." },
      { match: "GOAL:", text: "SATISFIED: complete." },
      { match: "Synthesize", text: "42." },
    ]);
    await Effect.runPromise(
      provideTestEnvelope(
        executePlanExecute({
          taskDescription: "What is 6 times 7?",
          taskType: "simple",
          memoryContext: "",
          availableTools: [],
          availableToolSchemas: [],
          config: defaultReasoningConfig,
        }),
        env,
      ).pipe(Effect.provide(llm)),
    );
    const dumps = readdirSync(dir).filter((f) => f.startsWith("dump-iter"));
    expect(dumps.length).toBeGreaterThan(0);
    const first = JSON.parse(readFileSync(join(dir, dumps[0]!), "utf8")) as {
      readonly conversationMessages: readonly unknown[];
    };
    expect(JSON.stringify(first.conversationMessages)).toContain("OVERALL GOAL");
  });
});
