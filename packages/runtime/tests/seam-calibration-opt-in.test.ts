/**
 * Seam pin: the learned and community calibration tiers are opt-in.
 *
 * With no calibration options, `calibration: "auto"` resolves the shipped
 * tier only: recorded run observations never change the calibration and no
 * community profile is requested. `.withCalibration("auto", { learned,
 * community })` turns each tier on; the community request still honors
 * DO_NOT_TRACK / REACTIVE_AGENTS_TELEMETRY=0.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { appendObservation, type RunObservation } from "@reactive-agents/reactive-intelligence";
import { resolveCalibration } from "../src/engine/phases/agent-loop/setup/calibration";
import { withCalibrationTiers } from "../src/builder/withers/calibration";
import { asBuilderState } from "../src/builder/withers/_state";
import { ReactiveAgents } from "../src/builder";
import { agentConfigFromJSON, agentConfigToBuilder, agentConfigToJSON } from "../src/agent-config";

const ENV_KEYS = ["DO_NOT_TRACK", "REACTIVE_AGENTS_TELEMETRY", "REACTIVE_AGENTS_OBSERVATIONS_DIR"] as const;

const observation: RunObservation = {
  at: "2026-04-15T00:00:00.000Z",
  parallelTurnCount: 1,
  totalTurnCount: 3,
  dialect: "native-fc",
  classifierRequired: [],
  classifierActuallyCalled: [],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1.0,
};

describe("calibration tiers are opt-in", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const savedFetch = globalThis.fetch;
  let requested: string[] = [];
  let obsDir: string;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    obsDir = mkdtempSync(join(tmpdir(), "ra-cal-optin-"));
    process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"] = obsDir;
    requested = [];
    // 404 => no profile and no cache write, so every call reaches fetch.
    const recordingFetch = (input: string | URL | Request): Promise<Response> => {
      requested.push(String(input));
      return Promise.resolve(new Response("not found", { status: 404 }));
    };
    globalThis.fetch = recordingFetch as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    rmSync(obsDir, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  const uniqueModel = (tag: string) => `optin-probe-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const recordRuns = (modelId: string, n: number) => {
    for (let i = 0; i < n; i++) appendObservation(modelId, observation, { baseDir: obsDir });
  };
  const resolve = (modelId: string, reactiveIntelligenceOptions?: Record<string, unknown>) =>
    Effect.runPromise(
      resolveCalibration({ calibration: "auto", provider: "test", defaultModel: modelId, reactiveIntelligenceOptions }),
    );

  test("default: 5 recorded runs do not change the calibration and nothing is fetched", async () => {
    const model = uniqueModel("default");
    recordRuns(model, 5);
    expect(await resolve(model)).toBeUndefined();
    expect(requested).toEqual([]);
  });

  test("learnedCalibration: true applies the recorded runs", async () => {
    const model = uniqueModel("learned");
    recordRuns(model, 5);
    const cal = await resolve(model, { learnedCalibration: true });
    expect(cal?.parallelCallCapability).toBe("reliable");
    expect(requested).toEqual([]);
  });

  test("communityCalibration: true requests the community profile once", async () => {
    const model = uniqueModel("community");
    await resolve(model, { communityCalibration: true });
    expect(requested.length).toBe(1);
    expect(requested[0]).toContain(encodeURIComponent(model));
  });

  test("communityCalibration: true under DO_NOT_TRACK=1 makes no request", async () => {
    process.env["DO_NOT_TRACK"] = "1";
    await resolve(uniqueModel("community-dnt"), { communityCalibration: true });
    expect(requested).toEqual([]);
  });

  test("withCalibrationTiers leaves the options untouched when no tier is set", () => {
    const ri = { telemetry: false };
    expect(withCalibrationTiers(ri, undefined)).toBe(ri);
    expect(withCalibrationTiers(undefined, {})).toBeUndefined();
  });

  test("withCalibrationTiers sets the flags, overriding a .withReactiveIntelligence key", () => {
    expect(withCalibrationTiers(undefined, { learned: true, community: true })).toEqual({
      learnedCalibration: true,
      communityCalibration: true,
    });
    const ri = { telemetry: false, communityCalibration: true } as Parameters<typeof withCalibrationTiers>[0];
    expect(withCalibrationTiers(ri, { community: false })).toEqual({ telemetry: false, communityCalibration: false });
  });

  test(".withCalibration(mode, options) stores both on the builder", () => {
    const builder = ReactiveAgents.create().withCalibration("auto", { learned: true });
    const state = asBuilderState(builder);
    expect(state._calibration).toBe("auto");
    expect(state._calibrationOptions).toEqual({ learned: true });
  });

  test("end to end: .withCalibration('auto', { community: true }) reaches the engine", async () => {
    const model = uniqueModel("e2e");
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withModel(model)
      .withTestScenario([{ text: "done" }])
      .withReasoning()
      .withCalibration("auto", { community: true })
      .build();
    try {
      await agent.run("say done");
    } finally {
      await agent.dispose();
    }
    expect(requested.filter((u) => u.includes(encodeURIComponent(model))).length).toBe(1);
  }, 20000);

  test("end to end: an agent with no calibration options requests nothing", async () => {
    const model = uniqueModel("e2e-default");
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withModel(model)
      .withTestScenario([{ text: "done" }])
      .withReasoning()
      .build();
    try {
      await agent.run("say done");
    } finally {
      await agent.dispose();
    }
    expect(requested.filter((u) => u.includes(encodeURIComponent(model)))).toEqual([]);
  }, 20000);
});

// Agent-as-data: `toConfig()` -> JSON -> `agentConfigToBuilder()` must keep the
// calibration mode and both opt-in tiers. Before the `calibration` config key
// existed, the round trip dropped them and a reloaded agent ran on defaults.
describe("calibration options round-trip through AgentConfig", () => {
  const reload = async (builder: ReturnType<typeof ReactiveAgents.create>) =>
    agentConfigToBuilder(agentConfigFromJSON(agentConfigToJSON(builder.toConfig())));

  test(".withCalibration('auto', { learned, community }) survives toConfig -> JSON -> builder", async () => {
    const src = ReactiveAgents.create()
      .withName("cal-pin")
      .withProvider("anthropic")
      .withCalibration("auto", { learned: true, community: true });
    expect(src.toConfig().calibration).toEqual({ mode: "auto", learned: true, community: true });
    const rebuilt = await reload(src);
    const state = asBuilderState(rebuilt);
    expect(state._calibration).toBe("auto");
    expect(state._calibrationOptions).toEqual({ learned: true, community: true });
    expect(rebuilt.toConfig()).toEqual(src.toConfig());
  });

  test("an explicit .withCalibration('skip') survives the round trip", async () => {
    const src = ReactiveAgents.create().withName("cal-skip").withProvider("anthropic").withCalibration("skip");
    expect(src.toConfig().calibration).toEqual({ mode: "skip" });
    expect(asBuilderState(await reload(src))._calibration).toBe("skip");
  });

  test("a builder that never called .withCalibration emits no calibration key", () => {
    const cfg = ReactiveAgents.create().withName("cal-default").withProvider("anthropic").toConfig();
    expect("calibration" in cfg).toBe(false);
  });
});
