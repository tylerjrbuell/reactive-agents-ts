// Run: bun test packages/runtime/tests/builder-judgment.test.ts --timeout 15000
//
// `.withJudgment()` — Task 8 of
// wiki/Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer.md.
//
// Pins:
//   1. ABSENCE — a bare builder (no `.withJudgment()`) never resolves
//      `JudgmentService` (genuinely absent from the Layer graph, not a
//      dummy/no-op stand-in) and `agent.judge()` rejects.
//   2. PRESENCE — `.withJudgment()` makes `JudgmentService` resolvable and
//      `agent.judge()` answers Choice/Score/Noul questions via a
//      fake/stub `LLMService` (the "llm" emulation backend).
//   3. SITES DEFAULT OFF — `JudgmentSites` is unset unless explicitly
//      passed; passing no `sites` still allows `agent.judge()` to work.
//   4. BACKEND SELECTION — deterministic from config/env presence: an
//      explicit `apiKey` (or `TYPESAFE_API_KEY`) selects "jev"; its absence
//      selects "llm"; `backend` always overrides.

import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, DEFAULT_CAPABILITIES } from "@reactive-agents/llm-provider";
import type {
  ModelConfig,
  StructuredOutputCapabilities,
} from "@reactive-agents/llm-provider";
import { JudgmentService } from "@reactive-agents/judgment";
import { ReactiveAgents } from "../src/index.js";

/**
 * A fake `LLMService` whose `completeStructured()` answers a single known
 * "noul" judgment question — enough for the `llm` backend's batched-Choice/
 * Score/Noul schema without a live provider. Every other method either
 * defects (unused in this path) or returns a minimal valid stub.
 */
const makeFakeLLM = (completeStructuredCallCount: { count: number }): Layer.Layer<LLMService> =>
  Layer.succeed(LLMService, {
    complete: () => Effect.die(new Error("unused in this test")),
    stream: () => Effect.die(new Error("unused in this test")),
    completeStructured: <A>() => {
      completeStructuredCallCount.count += 1;
      // Matches the `llm` backend's per-question schema for a single "noul"
      // question keyed "risky" (see `packages/judgment/src/backends/llm-backend.ts`
      // `questionFieldSchema`): `{ probability: number }`.
      return Effect.succeed({ risky: { probability: 0.83 } } as unknown as A);
    },
    embed: () => Effect.die(new Error("unused in this test")),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () =>
      Effect.succeed({ provider: "custom", model: "fake-model" } as ModelConfig),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: true,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      } as StructuredOutputCapabilities),
    capabilities: () => Effect.succeed(DEFAULT_CAPABILITIES),
  });

const noulQuestion = {
  risky: {
    type: "noul" as const,
    instructions: "Is this action destructive?",
  },
};

describe(".withJudgment() — Task 8 builder wiring", () => {
  const agentsToDispose: Array<{ dispose: () => Promise<void> }> = [];
  afterEach(async () => {
    while (agentsToDispose.length > 0) {
      await agentsToDispose.pop()!.dispose();
    }
  });

  it("ABSENCE: bare builder never resolves JudgmentService", async () => {
    const agent = await ReactiveAgents.create()
      .withName("no-judgment-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    agentsToDispose.push(agent);

    // The layer requirement is genuinely absent — Effect.serviceOption
    // resolves to None, not a dummy backend silently answering.
    const svcOpt = await agent.runtime.runPromise(
      Effect.serviceOption(JudgmentService)
    );
    expect(svcOpt._tag).toBe("None");

    // Public primitive fails clearly/typed instead of silently no-op'ing.
    await expect(
      agent.judge({ state: { x: 1 }, questions: noulQuestion })
    ).rejects.toBeTruthy();

    // Existing runtime behavior is byte-identical without the call.
    const result = await agent.run("simple task");
    expect(result.success).toBe(true);
  });

  it("PRESENCE: .withJudgment() resolves the layer; agent.judge() answers via a fake LLM backend", async () => {
    const callCount = { count: 0 };
    const agent = await ReactiveAgents.create()
      .withName("judgment-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(makeFakeLLM(callCount))
      // Explicit backend: this repo's own dev `.env` carries a real
      // TYPESAFE_API_KEY (used by the judgment package's own live tests) —
      // force "llm" so this test stays deterministic/offline regardless of
      // that env var's presence. See the dedicated BACKEND SELECTION test
      // below for the presence-based default itself.
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    const svcOpt = await agent.runtime.runPromise(
      Effect.serviceOption(JudgmentService)
    );
    expect(svcOpt._tag).toBe("Some");

    const answers = await agent.judge({
      state: { action: "delete all files in /tmp" },
      questions: noulQuestion,
    });
    expect(answers.risky.kind).toBe("noul");
    expect(answers.risky.kind === "noul" && answers.risky.probability).toBeCloseTo(0.83);
    expect(callCount.count).toBe(1);
  });

  it("SITES DEFAULT OFF: .withJudgment() with no sites still resolves and answers", async () => {
    const agent = await ReactiveAgents.create()
      .withName("judgment-sites-default-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(makeFakeLLM({ count: 0 }))
      // `sites` intentionally omitted — must still default-resolve + answer.
      // `backend: "llm"` forced for the same offline-determinism reason as
      // the PRESENCE test above.
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    const answers = await agent.judge({ state: null, questions: noulQuestion });
    expect(answers.risky.kind).toBe("noul");
  });

  it("TYPE: state is only optional when includeContext:true (final review #4) — omitting both is a compile error, `state: null` stays valid", async () => {
    const agent = await ReactiveAgents.create()
      .withName("judgment-type-hole-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(makeFakeLLM({ count: 0 }))
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    // @ts-expect-error — neither `state` nor `includeContext` is present;
    // before the fix this typechecked and passed `undefined` through to
    // JudgmentService.ask() (which requires a real JudgmentEntry, and
    // eventually JSON.stringify()s it in the llm backend).
    agent.judge({ questions: noulQuestion });

    // `state: null` is still a legitimate explicit JudgmentEntry (distinct
    // from omitting `state` entirely) and must remain valid without
    // `includeContext`.
    const answers = await agent.judge({ state: null, questions: noulQuestion });
    expect(answers.risky.kind).toBe("noul");

    // `includeContext: true` with `state` omitted is still valid (Task 1's
    // whole point).
    const withContext = await agent.judge({ questions: noulQuestion, includeContext: true });
    expect(withContext.risky.kind).toBe("noul");
  });

  it("BACKEND SELECTION: apiKey/env absence selects llm; presence selects jev (not the llm stub)", async () => {
    const priorKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      // No apiKey, no env var, no explicit backend → "llm" → uses the fake LLM.
      const callCount = { count: 0 };
      const llmAgent = await ReactiveAgents.create()
        .withName("judgment-backend-llm-agent")
        .withProvider("test")
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning({ defaultStrategy: "reactive" })
        .withReplayLLM(makeFakeLLM(callCount))
        .withJudgment()
        .build();
      agentsToDispose.push(llmAgent);

      await llmAgent.judge({ state: null, questions: noulQuestion });
      expect(callCount.count).toBe(1);

      // An explicit apiKey (config, not env) selects "jev" — proven by NOT
      // going through the fake LLM (call count stays 0) and instead
      // attempting a real jev round trip against an unreachable local port,
      // which fails fast (connection refused, no 3s timeout wait) instead
      // of hanging on a live network call.
      const jevCallCount = { count: 0 };
      const jevAgent = await ReactiveAgents.create()
        .withName("judgment-backend-jev-agent")
        .withProvider("test")
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning({ defaultStrategy: "reactive" })
        .withReplayLLM(makeFakeLLM(jevCallCount))
        .withJudgment({ apiKey: "fake-key-for-test", baseUrl: "http://127.0.0.1:1" })
        .build();
      agentsToDispose.push(jevAgent);

      await expect(
        jevAgent.judge({ state: null, questions: noulQuestion })
      ).rejects.toBeTruthy();
      expect(jevCallCount.count).toBe(0);
    } finally {
      if (priorKey !== undefined) process.env.TYPESAFE_API_KEY = priorKey;
    }
  });
});
