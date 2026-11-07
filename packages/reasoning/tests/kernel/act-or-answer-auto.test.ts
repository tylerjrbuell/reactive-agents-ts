// Run: bun test packages/reasoning/tests/kernel/act-or-answer-auto.test.ts --timeout 15000
//
// `actOrAnswer: "auto"` picks the mode per model through ONE pure resolver
// (harness-config.ts `resolveActOrAnswer`), and the kernel resolves an
// unresolved "auto" once at run start (`resolveRunStartHarness`, called by
// runKernel), so no think turn ever reads "auto".
import { afterEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  resolveActOrAnswer,
  resolveHarnessConfig,
  resolveRunStartHarness,
  type ActOrAnswerSetting,
} from "../../src/harness-config.js";
import { actOrAnswerMode } from "../../src/harness-flags.js";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { transitionState, type KernelInput, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";

afterEach(() => {
  delete process.env.RA_ACT_OR_ANSWER;
});

describe("resolveActOrAnswer — resolver table", () => {
  const explicit: readonly [ActOrAnswerSetting, boolean | "proactive"][] = [
    [true, true],
    [false, false],
    ["proactive", "proactive"],
  ];

  it("an explicit mode wins over calibration and provider", () => {
    for (const [configured, mode] of explicit) {
      for (const provider of ["ollama", "anthropic", undefined]) {
        expect(resolveActOrAnswer(configured, { actOrAnswer: "proactive" }, provider)).toEqual({ mode, source: "explicit" });
        expect(resolveActOrAnswer(configured, undefined, provider)).toEqual({ mode, source: "explicit" });
      }
    }
  });

  it("auto with a calibration takes the learned choice on any provider", () => {
    for (const provider of ["ollama", "anthropic"]) {
      expect(resolveActOrAnswer("auto", { actOrAnswer: "proactive" }, provider)).toEqual({ mode: "proactive", source: "calibration" });
      expect(resolveActOrAnswer("auto", { actOrAnswer: "retry" }, provider)).toEqual({ mode: true, source: "calibration" });
      expect(resolveActOrAnswer("auto", { actOrAnswer: "off" }, provider)).toEqual({ mode: false, source: "calibration" });
    }
  });

  it("auto without a learned choice: retry on Ollama, off elsewhere", () => {
    expect(resolveActOrAnswer("auto", undefined, "ollama")).toEqual({ mode: true, source: "default" });
    expect(resolveActOrAnswer("auto", {}, "ollama")).toEqual({ mode: true, source: "default" });
    expect(resolveActOrAnswer("auto", undefined, "anthropic")).toEqual({ mode: false, source: "default" });
    expect(resolveActOrAnswer("auto", {}, "anthropic")).toEqual({ mode: false, source: "default" });
    expect(resolveActOrAnswer("auto", undefined, undefined)).toEqual({ mode: false, source: "default" });
  });

  it("RA_ACT_OR_ANSWER=auto and config auto both reach the resolved harness as auto", () => {
    process.env.RA_ACT_OR_ANSWER = "auto";
    expect(actOrAnswerMode()).toBe("auto");
    expect(resolveHarnessConfig().actOrAnswer).toBe("auto");
    delete process.env.RA_ACT_OR_ANSWER;
    expect(resolveHarnessConfig({ actOrAnswer: "auto" }).actOrAnswer).toBe("auto");
    // Default stays off.
    expect(resolveHarnessConfig().actOrAnswer).toBe(false);
  });
});

describe("resolveRunStartHarness", () => {
  it("returns the same input when there is no auto to resolve", () => {
    const input: KernelInput = { task: "t", harness: resolveHarnessConfig({ actOrAnswer: "proactive" }) };
    expect(resolveRunStartHarness(input)).toBe(input);
    const bare: KernelInput = { task: "t" };
    expect(resolveRunStartHarness(bare)).toBe(bare);
  });

  it("resolves auto from the input's calibration and provider, keeping every other harness field", () => {
    const harness = resolveHarnessConfig({ actOrAnswer: "auto", toolIndex: true });
    const out = resolveRunStartHarness({ task: "t", harness, providerName: "ollama" });
    expect(out.harness?.actOrAnswer).toBe(true);
    expect({ ...out.harness, actOrAnswer: "auto" }).toEqual({ ...harness });
    const learned = resolveRunStartHarness({ task: "t", harness, providerName: "ollama", calibration: { actOrAnswer: "off" } });
    expect(learned.harness?.actOrAnswer).toBe(false);
  });

  it("an env-only auto (no input harness) is resolved too", () => {
    process.env.RA_ACT_OR_ANSWER = "auto";
    expect(resolveRunStartHarness({ task: "t", providerName: "ollama" }).harness?.actOrAnswer).toBe(true);
    expect(resolveRunStartHarness({ task: "t", providerName: "anthropic" }).harness?.actOrAnswer).toBe(false);
  });
});

describe("runKernel resolves auto at run start: no phase sees it", () => {
  async function seen(input: KernelInput): Promise<unknown> {
    let mode: unknown = "never-called";
    const probe: ThoughtKernel = (state, ctx) => {
      mode = ctx.input.harness?.actOrAnswer;
      return Effect.succeed(transitionState(state, { status: "done", output: "ok", iteration: state.iteration + 1 }));
    };
    await Effect.runPromise(
      runKernel(probe, input, { maxIterations: 3, strategy: "test", kernelType: "test" }).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    return mode;
  }

  it("auto on Ollama runs as retry; on Anthropic as off; a learned choice wins", async () => {
    const harness = resolveHarnessConfig({ actOrAnswer: "auto" });
    expect(await seen({ task: "t", harness, providerName: "ollama" })).toBe(true);
    expect(await seen({ task: "t", harness, providerName: "anthropic" })).toBe(false);
    expect(
      await seen({
        task: "t",
        harness,
        providerName: "anthropic",
        calibration: {
          modelId: "m",
          calibratedAt: "2026-11-06T00:00:00.000Z",
          probeVersion: 1,
          runsAveraged: 1,
          steeringCompliance: "hybrid",
          parallelCallCapability: "partial",
          observationHandling: "uses-recall",
          systemPromptAttention: "strong",
          optimalToolResultChars: 1000,
          toolCallDialect: "native-fc",
          actOrAnswer: "proactive",
        },
      }),
    ).toBe("proactive");
  }, 15000);

  it("an env-only auto is resolved before the first phase", async () => {
    process.env.RA_ACT_OR_ANSWER = "auto";
    expect(await seen({ task: "t", providerName: "anthropic" })).toBe(false);
  }, 15000);
});
