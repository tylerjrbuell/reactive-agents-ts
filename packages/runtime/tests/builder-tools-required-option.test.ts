/**
 * `.withTools({ required })` ≡ `.withRequiredTools()` — exemplar
 * wither-surface consolidation fold (2026-07-11, north-star §5
 * "one concept, one entry point"; audit:
 * wiki/Research/Audit-Reports-2026-07-11/wither-surface-consolidation.md).
 *
 * Pins:
 *   1. EQUIVALENCE — both spellings produce identical `toConfig()` output
 *      (same `_requiredToolsConfig` state slot → same serialization → same
 *      downstream KernelInput.requiredTools / enforcement quota).
 *   2. SHORTHAND — `required: ["x"]` ≡ `required: { tools: ["x"] }`.
 *   3. CONFLICT RULE — both spellings combined: tool lists UNION (deduped,
 *      first-seen order); scalar fields (`adaptive`, `maxRetries`) are
 *      last-call-wins.
 *   4. CLASSIFIER SUPPRESSION — a static required list set via the NEW
 *      option suppresses the adaptive tool classifier exactly like the old
 *      method (mirrors "preserves caller-supplied requiredTools.tools" in
 *      engine-phases-classifier.test.ts, driven through the builder).
 *   5. BACK-COMPAT — old method keeps working standalone; no new builder
 *      method exists (fold is a config option, not a wither).
 */
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/index.js";
import { classifyTools } from "../src/engine/phases/agent-loop/setup/classifier.js";
import type { ReactiveAgentsConfig } from "../src/types.js";
import type { Task } from "@reactive-agents/core";

// ─── Fixtures (mirrors engine-phases-classifier.test.ts) ───

const makeTask = (input: unknown): Task =>
  ({
    id: "t-required-option",
    agentId: "agent-required-option",
    type: "query",
    input,
    priority: "medium",
    status: "pending",
    metadata: { tags: [] },
    createdAt: new Date(),
  }) as unknown as Task;

// LLMService stub that fails if invoked — verifies the "no LLM call" branch
const FailIfInvokedLLMLayer = Layer.succeed(LLMService, {
  complete: () =>
    Effect.die(new Error("LLM should not be invoked on this branch")),
  stream: () =>
    Effect.die(new Error("LLM should not be invoked on this branch")),
} as unknown as Context.Tag.Service<typeof LLMService>);

const baseBuilder = () =>
  ReactiveAgents.create().withName("required-fold").withProvider("test");

describe(".withTools({ required }) ≡ .withRequiredTools() (consolidation fold)", () => {
  it("object form produces the exact same toConfig() as .withRequiredTools()", () => {
    const viaOption = baseBuilder()
      .withTools({ required: { tools: ["web-search"], maxRetries: 3 } })
      .toConfig();
    const viaMethod = baseBuilder()
      .withTools()
      .withRequiredTools({ tools: ["web-search"], maxRetries: 3 })
      .toConfig();

    expect(viaOption.requiredTools).toEqual({
      tools: ["web-search"],
      maxRetries: 3,
    });
    // Whole-config equivalence: identical downstream behavior by construction
    expect(viaOption).toEqual(viaMethod);
  });

  it("bare-array shorthand ≡ { tools: [...] } object form", () => {
    const shorthand = baseBuilder()
      .withTools({ required: ["web-search", "file-read"] })
      .toConfig();
    const longform = baseBuilder()
      .withTools({ required: { tools: ["web-search", "file-read"] } })
      .toConfig();

    expect(shorthand.requiredTools).toEqual({
      tools: ["web-search", "file-read"],
    });
    expect(shorthand).toEqual(longform);
  });

  it("adaptive opt-out spelling is equivalent (.withRequiredTools({adaptive:false}) parity)", () => {
    const viaOption = baseBuilder()
      .withTools({ required: { adaptive: false } })
      .toConfig();
    const viaMethod = baseBuilder()
      .withTools()
      .withRequiredTools({ adaptive: false })
      .toConfig();

    expect(viaOption.requiredTools).toEqual({ adaptive: false });
    expect(viaOption).toEqual(viaMethod);
  });

  it("both spellings combined: tools UNION (deduped, first-seen order), scalars last-wins", () => {
    const config = baseBuilder()
      .withRequiredTools({ tools: ["a", "b"], maxRetries: 1, adaptive: true })
      .withTools({
        required: { tools: ["b", "c"], maxRetries: 5, adaptive: false },
      })
      .toConfig();

    expect(config.requiredTools).toEqual({
      tools: ["a", "b", "c"], // union, deduped, first-seen order
      maxRetries: 5, // last-call-wins
      adaptive: false, // last-call-wins
    });

    // Reverse order: withTools({required}) first, withRequiredTools last
    const reversed = baseBuilder()
      .withTools({ required: { tools: ["b", "c"], maxRetries: 5 } })
      .withRequiredTools({ tools: ["a"] })
      .toConfig();
    expect(reversed.requiredTools).toEqual({
      tools: ["b", "c", "a"],
      maxRetries: 5, // untouched by second call (not supplied)
    });
  });

  it("static list via NEW option suppresses the adaptive classifier (no LLM call)", async () => {
    // Drive the requiredTools config through the builder's new spelling,
    // then feed it to classifyTools with an LLM layer that dies if invoked —
    // exactly the guarantee the old .withRequiredTools() path pins.
    const built = baseBuilder()
      .withTools({ required: { tools: ["search", "summarize"] } })
      .toConfig();

    const config = {
      agentId: "agent-required-option",
      enableGuardrails: false,
      // reasoning enabled → classifier would default ON without a static list
      reasoningOptions: {},
      requiredTools: built.requiredTools,
    } as unknown as ReactiveAgentsConfig;

    const result = await Effect.runPromise(
      classifyTools({
        config,
        task: makeTask("research a topic"),
        cachedToolDefs: [{ name: "search" }, { name: "summarize" }],
        resolvedCalibration: {
          classifierReliability: "high",
        } as unknown as ModelCalibration,
        obs: null,
        isNormal: false,
      }).pipe(Effect.provide(FailIfInvokedLLMLayer)) as Effect.Effect<
        {
          effectiveRequiredTools: readonly string[] | undefined;
        },
        never,
        never
      >,
    );

    // Static list preserved verbatim — enforcement quota identical to the
    // old method (same config path into KernelInput.requiredTools).
    expect(result.effectiveRequiredTools).toEqual(["search", "summarize"]);
  });

  it("old method still works standalone (back-compat, no delegation regression)", () => {
    const config = baseBuilder()
      .withTools()
      .withRequiredTools({ tools: ["file-write"], adaptive: true, maxRetries: 2 })
      .toConfig();

    expect(config.requiredTools).toEqual({
      tools: ["file-write"],
      adaptive: true,
      maxRetries: 2,
    });
  });

  it("`required` is NOT leaked into the tools options slot (single state slot)", () => {
    const config = baseBuilder()
      .withTools({ required: ["web-search"], adaptive: true })
      .toConfig();

    // `adaptive` (tool filtering) serializes under tools; `required` under
    // requiredTools — no duplicate/conflicting carrier.
    expect(config.tools).toEqual({ adaptive: true });
    expect(config.requiredTools).toEqual({ tools: ["web-search"] });
  });
});
