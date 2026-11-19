// Run: bun run repo test packages/reasoning/tests/kernel/calibration-mode.test.ts
//
// F1 (adaptive-harness audit 2026-11-19): a calibration-off arm must carry no
// shipped calibration anywhere in the kernel. `KernelInput.calibrationMode`
// reaches selectAdapter's 4th arg at the runner, act and think sites, and the
// run records one `capability-resolved` event.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect, Ref } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { applyCalibrationProfileOverrides } from "../../src/kernel/loop/runner-profile-overrides.js";
import { CAPABILITY_RESOLVED_GUARD, adapterCalibrationArg } from "../../src/kernel/utils/calibration-trace.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

const collect = <A>(program: Effect.Effect<A, never, EventBus>, guard: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const seen = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (ev) =>
        ev._tag === "GuardFiredEmitted" && ev.guard === guard ? Ref.update(seen, (xs) => [...xs, ev]) : Effect.void);
      const result = yield* program;
      return { result, events: yield* Ref.get(seen) };
    }).pipe(Effect.provide(EventBusLive)),
  );

const PROFILE_OVERRIDES = "profile-overrides-applied";
const local = { ...CONTEXT_PROFILES.local, toolResultMaxChars: 1200 };

describe("runner site: applyCalibrationProfileOverrides", () => {
  it("auto (default) still applies the shipped toolResultMaxChars override", async () => {
    const { result, events } = await collect(applyCalibrationProfileOverrides(local, "cogito:14b", "t"), PROFILE_OVERRIDES);
    expect(events.length).toBeGreaterThan(0);
    expect(result.toolResultMaxChars).not.toBe(1200);
  });

  it("skip applies no profile override at all", async () => {
    const { result, events } = await collect(
      applyCalibrationProfileOverrides(local, "cogito:14b", "t", { calibrationMode: "skip" }),
      PROFILE_OVERRIDES,
    );
    expect(events).toEqual([]);
    expect(result).toBe(local);
  });
});

describe("capability-resolved", () => {
  it("is emitted once per run with provider, model, source, tier, ctx, thinking", async () => {
    const { events } = await collect(
      applyCalibrationProfileOverrides(local, "cogito:14b", "t", { providerName: "ollama" }),
      CAPABILITY_RESOLVED_GUARD,
    );
    expect(events.length).toBe(1);
    const m = events[0]!._tag === "GuardFiredEmitted" ? (events[0]!.metadata ?? {}) : {};
    expect(Object.keys(m).sort()).toEqual(["model", "provider", "recommendedNumCtx", "source", "supportsThinkingMode", "tier"]);
    expect(m.provider).toBe("ollama");
    expect(m.model).toBe("cogito:14b");
  });

  it("is not emitted without a provider", async () => {
    const { events } = await collect(applyCalibrationProfileOverrides(local, "cogito:14b", "t"), CAPABILITY_RESOLVED_GUARD);
    expect(events).toEqual([]);
  });
});

describe("adapterCalibrationArg", () => {
  it("defaults to auto; passes skip through", () => {
    expect(adapterCalibrationArg({})).toBe("auto");
    expect(adapterCalibrationArg({ calibrationMode: "skip" })).toBe("skip");
  });
});

describe("act and think sites pass the mode as selectAdapter's 4th argument", () => {
  const src = (rel: string) => readFileSync(join(import.meta.dir, "../../src/kernel/capabilities", rel), "utf8");
  for (const rel of ["act/act.ts", "reason/think.ts"]) {
    it(rel, () => {
      expect(src(rel)).toContain("selectAdapter({ supportsToolCalling: true }, profile.tier, input.modelId, adapterCalibrationArg(input))");
    });
  }
});
