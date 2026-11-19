// Run: bun run repo test packages/reasoning/tests/kernel/calibration-trace.test.ts
//
// Adaptive-harness audit 2026-11-19 (G4-G7, G9): a trace must say what a
// calibration changed. Additive events only: `profile-overrides-applied`,
// `calibration-effect`, the `default-off` act-or-answer source, and the
// native-fc dialect for native calls.
import { describe, expect, it } from "bun:test";
import { Effect, Ref } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { applyCalibrationProfileOverrides } from "../../src/kernel/loop/runner-profile-overrides.js";
import {
  CALIBRATION_EFFECT_GUARD,
  PROFILE_OVERRIDES_APPLIED_GUARD,
  emitCalibrationEffect,
  profileOverrideChanges,
} from "../../src/kernel/utils/calibration-trace.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { describeResolution } from "../../src/kernel/capabilities/reason/assistant-turn.js";
import { resolveActOrAnswer, actOrAnswerIsDefault } from "../../src/harness-config.js";
import { resolveWorkerConcurrency } from "../../src/strategies/blueprint.js";

const guardsOf = <A>(program: Effect.Effect<A, never, EventBus>, names: readonly string[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const seen = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (ev) =>
        ev._tag === "GuardFiredEmitted" && names.includes(ev.guard) ? Ref.update(seen, (xs) => [...xs, ev]) : Effect.void);
      const result = yield* program;
      return { result, events: yield* Ref.get(seen) };
    }).pipe(Effect.provide(EventBusLive)),
  );

const metaOf = (ev: AgentEvent): Record<string, unknown> =>
  ev._tag === "GuardFiredEmitted" && ev.metadata !== undefined ? ev.metadata : {};

describe("profileOverrideChanges", () => {
  it("lists only fields whose value changes, with from/to/source", () => {
    expect(profileOverrideChanges({ a: 1, b: 2 }, { a: 5, b: 2, c: 9 }, "calibration")).toEqual([
      { field: "a", from: 1, to: 5, source: "calibration" },
      { field: "c", from: undefined, to: 9, source: "calibration" },
    ]);
  });
});

describe("profile-overrides-applied", () => {
  it("a calibrated model records each overridden profile field", async () => {
    const base = CONTEXT_PROFILES.local;
    const { result, events } = await guardsOf(
      applyCalibrationProfileOverrides({ ...base, toolResultMaxChars: 1200 }, "cogito:14b", "t-1"),
      [PROFILE_OVERRIDES_APPLIED_GUARD],
    );
    expect(events.length).toBeGreaterThan(0);
    const m = metaOf(events[0]!);
    expect(m.source).toBe("calibration");
    expect(Reflect.get(result, String(m.field))).toBe(m.to);
    expect(m.from).not.toBe(m.to);
  });

  it("a model with no calibration records nothing and returns the base profile", async () => {
    const base = CONTEXT_PROFILES.mid;
    const { result, events } = await guardsOf(applyCalibrationProfileOverrides(base, "no-such-model-xyz", "t-1"), [PROFILE_OVERRIDES_APPLIED_GUARD]);
    expect(events).toEqual([]);
    expect(result).toBe(base);
  });
});

describe("calibration-effect", () => {
  it("emits field, value, consumer and effect", async () => {
    const { events } = await guardsOf(
      emitCalibrationEffect("t-1", 0, { field: "parallelCallCapability", value: "partial", consumer: "blueprint-worker", effect: "concurrency=2" }),
      [CALIBRATION_EFFECT_GUARD],
    );
    expect(metaOf(events[0]!)).toEqual({ field: "parallelCallCapability", value: "partial", consumer: "blueprint-worker", effect: "concurrency=2" });
  });

  it("blueprint names the calibration field that capped concurrency; tier fallback names none", () => {
    const cal = { parallelCallCapability: "sequential-only" } as const;
    const capped = resolveWorkerConcurrency({ modelId: "m", calibration: cal } as never);
    expect(capped.value).toBe(1);
    expect(capped.cause).toEqual({ field: "parallelCallCapability", value: "sequential-only", consumer: "blueprint-worker-concurrency", effect: "concurrency=1" });
    expect(resolveWorkerConcurrency({ modelId: "m" } as never).cause).toBeUndefined();
  });
});

describe("actOrAnswerSource default-off (G6)", () => {
  it("an unconfigured false is default-off; a configured false stays explicit", () => {
    expect(resolveActOrAnswer(false, undefined, "anthropic", true)).toEqual({ mode: false, source: "default-off" });
    expect(resolveActOrAnswer(false, undefined, "anthropic")).toEqual({ mode: false, source: "explicit" });
    expect(resolveActOrAnswer(true, undefined, "ollama", true)).toEqual({ mode: true, source: "explicit" });
  });

  it("unconfigured means no config value and no RA_ACT_OR_ANSWER", () => {
    const prior = process.env.RA_ACT_OR_ANSWER;
    try {
      delete process.env.RA_ACT_OR_ANSWER;
      expect(actOrAnswerIsDefault(undefined)).toBe(true);
      expect(actOrAnswerIsDefault({ actOrAnswer: false })).toBe(false);
      process.env.RA_ACT_OR_ANSWER = "0";
      expect(actOrAnswerIsDefault(undefined)).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.RA_ACT_OR_ANSWER;
      else process.env.RA_ACT_OR_ANSWER = prior;
    }
  });
});

describe("native-fc dialect (G9)", () => {
  const nativeCall = { id: "tc1", name: "file-read", input: "{}" };
  it("native calls the resolver reports as 'none' are native-fc", () => {
    const meta = describeResolution(
      { result: { _tag: "tool_calls", calls: [{ id: "tc1", name: "file-read", arguments: {} }], thinking: undefined }, dialect: "none" },
      { nativeCalls: [nativeCall], thought: "" },
    );
    expect(meta.source).toBe("native");
    expect(meta.dialect).toBe("native-fc");
  });

  it("a text-extracted call keeps its resolver dialect", () => {
    const meta = describeResolution(
      { result: { _tag: "tool_calls", calls: [{ id: "pseudo_1", name: "file-read", arguments: {} }], thinking: undefined }, dialect: "pseudo-code" },
      { nativeCalls: [], thought: "file-read()" },
    );
    expect(meta.dialect).toBe("pseudo-code");
  });
});
