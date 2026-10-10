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
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { LLMService, DEFAULT_CAPABILITIES } from "@reactive-agents/llm-provider";
import type {
  ModelConfig,
  StructuredCompletionRequest,
  StructuredOutputCapabilities,
} from "@reactive-agents/llm-provider";
import { EventBus } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import { ReactiveAgents, createLightRuntime } from "../src/index.js";
import { resolveBackendName } from "../src/judgment-layer.js";

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
    completeStructured: <A>(request: StructuredCompletionRequest<A>) => {
      completeStructuredCallCount.count += 1;
      // Matches the `llm` backend's per-question schema for a single "noul"
      // question keyed "risky" (see `packages/judgment/src/backends/llm-backend.ts`
      // `questionFieldSchema`): `{ probability: number }`.
      return Effect.succeed(
        Schema.decodeUnknownSync(request.outputSchema)({ risky: { probability: 0.83 } }),
      );
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

  it("OLLAMA SELECTION: backend:'ollama' routes to the ollama backend, not the fake LLM", async () => {
    const fakeLlmCallCount = { count: 0 };
    const events: Array<{ backend: string; errorTag: string }> = [];
    const agent = await ReactiveAgents.create()
      .withName("judgment-backend-ollama-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(makeFakeLLM(fakeLlmCallCount))
      .withJudgment({
        backend: "ollama",
        baseUrl: "http://127.0.0.1:1",
        ollama: { keepAlive: 0 },
      })
      .build();
    agentsToDispose.push(agent);

    const unsub = await agent.subscribe("JudgmentFailed", (event) => {
      events.push({ backend: event.backend, errorTag: event.errorTag });
    });
    try {
      await expect(
        agent.judge({ state: null, questions: noulQuestion })
      ).rejects.toBeTruthy();
    } finally {
      unsub();
    }

    expect(fakeLlmCallCount.count).toBe(0);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].backend).toBe("ollama");
    expect(events[0].errorTag).toBe("JudgmentConnectionError");
  });

  it("resolveBackendName: explicit backend always wins; else jev when an apiKey resolves; else llm", () => {
    const priorKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      // Explicit backend always overrides presence/absence of apiKey/env.
      expect(resolveBackendName({ backend: "llm", apiKey: "x" })).toBe("llm");
      expect(resolveBackendName({ backend: "ollama" })).toBe("ollama");

      // apiKey in config selects jev.
      expect(resolveBackendName({ apiKey: "config-key" })).toBe("jev");

      // No apiKey, no env → llm.
      expect(resolveBackendName(undefined)).toBe("llm");
      expect(resolveBackendName({})).toBe("llm");

      // Env var selects jev.
      process.env.TYPESAFE_API_KEY = "env-key";
      expect(resolveBackendName(undefined)).toBe("jev");
      expect(resolveBackendName({ backend: "jev" })).toBe("jev");

      // Explicit backend still wins over env var.
      expect(resolveBackendName({ backend: "llm" })).toBe("llm");
      expect(resolveBackendName({ backend: "ollama" })).toBe("ollama");
    } finally {
      if (priorKey !== undefined) {
        process.env.TYPESAFE_API_KEY = priorKey;
      } else {
        delete process.env.TYPESAFE_API_KEY;
      }
    }
  });

  it("both runtime tiers resolve the same backend for the same options", async () => {
    const priorKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const judgmentOptions = {
        backend: "ollama" as const,
        baseUrl: "http://127.0.0.1:1",
        ollama: { keepAlive: 0 },
      };

      // Root runtime tier.
      const rootEvents: Array<{ backend: string; errorTag: string }> = [];
      const rootAgent = await ReactiveAgents.create()
        .withName("root-judgment-tier-agent")
        .withProvider("test")
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning({ defaultStrategy: "reactive" })
        .withReplayLLM(makeFakeLLM({ count: 0 }))
        .withJudgment(judgmentOptions)
        .build();
      agentsToDispose.push(rootAgent);

      const rootUnsub = await rootAgent.subscribe("JudgmentFailed", (event) => {
        rootEvents.push({ backend: event.backend, errorTag: event.errorTag });
      });
      try {
        await expect(
          rootAgent.judge({ state: null, questions: noulQuestion })
        ).rejects.toBeTruthy();
      } finally {
        rootUnsub();
      }

      // Light/sub-agent runtime tier.
      const lightEvents: Array<{ backend: string; errorTag: string }> = [];
      const lightLayer = createLightRuntime({
        agentId: "light-judgment-tier-agent",
        provider: "test",
        enableJudgment: true,
        judgmentOptions,
      });
      const lightRuntime = ManagedRuntime.make(lightLayer);

      const lightUnsub = await lightRuntime.runPromise(
        Effect.gen(function* () {
          const eb = yield* EventBus;
          return yield* eb.subscribe((event) =>
            Effect.sync(() => {
              if (event._tag === "JudgmentFailed") {
                lightEvents.push({
                  backend: event.backend,
                  errorTag: event.errorTag,
                });
              }
            })
          );
        })
      );
      try {
        await expect(
          lightRuntime.runPromise(
            Effect.gen(function* () {
              const js = yield* JudgmentService;
              return yield* js.ask({ state: null, questions: noulQuestion });
            })
          )
        ).rejects.toBeTruthy();
      } finally {
        lightUnsub();
        await lightRuntime.dispose();
      }

      expect(rootEvents.length).toBeGreaterThanOrEqual(1);
      expect(lightEvents.length).toBeGreaterThanOrEqual(1);
      expect(rootEvents[0].backend).toBe("ollama");
      expect(lightEvents[0].backend).toBe("ollama");
      expect(rootEvents[0].errorTag).toBe("JudgmentConnectionError");
      expect(lightEvents[0].errorTag).toBe("JudgmentConnectionError");
    } finally {
      if (priorKey !== undefined) {
        process.env.TYPESAFE_API_KEY = priorKey;
      } else {
        delete process.env.TYPESAFE_API_KEY;
      }
    }
  });
});
