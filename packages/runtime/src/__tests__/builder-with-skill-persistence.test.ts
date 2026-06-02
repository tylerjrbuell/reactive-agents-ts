// Run: bun test packages/runtime/src/__tests__/builder-with-skill-persistence.test.ts --timeout 30000
//
// HS-122 / M6 graduation — verifies the `SkillStoreServiceLive` layer is wired
// into the runtime when memory is enabled, mirroring the SessionStoreLive
// precedent at `runtime.ts:1357`. Closes the anti-scaffold §9 gap (layer existed
// in @reactive-agents/memory but had no runtime consumer; agent.skills() always
// returned [] via the Effect.serviceOption fallback at reactive-agent.ts:370).
//
// Coverage:
//  (a) `.withSkillPersistence()` returns `this` (chainable).
//  (b) builder state field lands at the same site as `_sessionPersist`.
//  (c) runtime layer exposes SkillStoreService when enableMemory && skillPersistence !== false.
//  (d) default-on policy: skillPersistence unset + enableMemory:true → wired.
//  (e) explicit false disables even with memory on.
//  (f) absent without memory (policy: wire-when-memory-enabled).
//  (g) cross-session recall through a shared dbPath — proves the wiring path is
//      durable end-to-end (the M6 IMPROVE → KEEP graduation criterion).

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Effect, Layer } from "effect";
import { ReactiveAgents } from "../builder.js";
import { createRuntime } from "../runtime.js";
import { asBuilderState } from "./_helpers.js";
import { SkillStoreService } from "@reactive-agents/memory";
import type { SkillRecord } from "@reactive-agents/core";

describe(".withSkillPersistence() builder + runtime wiring", () => {
  it("(a) returns `this` for chaining and composes with other builder methods", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withMemory()
      .withSkillPersistence()
      .withReasoning();
    expect(builder).toBeDefined();
    const state = asBuilderState(builder);
    expect(state._skillPersistence).toBe(true);
  });

  it("(b) lands on _skillPersistence in BuilderRuntimeStateView", () => {
    const enabled = ReactiveAgents.create()
      .withProvider("test")
      .withSkillPersistence(true);
    const disabled = ReactiveAgents.create()
      .withProvider("test")
      .withSkillPersistence(false);
    const untouched = ReactiveAgents.create().withProvider("test");

    expect(asBuilderState(enabled)._skillPersistence).toBe(true);
    expect(asBuilderState(disabled)._skillPersistence).toBe(false);
    expect(asBuilderState(untouched)._skillPersistence).toBeUndefined();
  });
});

describe("createRuntime → SkillStoreServiceLive wiring", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      tmpDir = undefined;
    }
  });

  const probeServicePresence = async (
    layer: Layer.Layer<any, any, any>,
  ): Promise<boolean> => {
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const opt = yield* Effect.serviceOption(SkillStoreService);
          return opt._tag === "Some";
        }).pipe(Effect.provide(layer as Layer.Layer<any>)),
      ),
    );
  };

  it("(c) wires SkillStoreService when enableMemory:true + skillPersistence:true", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-skill-wire-"));
    const dbPath = path.join(tmpDir, "skills.db");

    const layer = createRuntime({
      agentId: "skill-wire-agent",
      provider: "test",
      enableMemory: true,
      memoryOptions: { dbPath },
      skillPersistence: true,
    });

    expect(await probeServicePresence(layer)).toBe(true);
  });

  it("(d) defaults to wired when enableMemory:true and skillPersistence is unset", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-skill-default-"));
    const dbPath = path.join(tmpDir, "skills.db");

    const layer = createRuntime({
      agentId: "skill-default-agent",
      provider: "test",
      enableMemory: true,
      memoryOptions: { dbPath },
      // skillPersistence: undefined — default-on policy expected
    });

    expect(await probeServicePresence(layer)).toBe(true);
  });

  it("(e) explicit false disables even when memory is on", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-skill-disabled-"));
    const dbPath = path.join(tmpDir, "skills.db");

    const layer = createRuntime({
      agentId: "skill-disabled-agent",
      provider: "test",
      enableMemory: true,
      memoryOptions: { dbPath },
      skillPersistence: false,
    });

    expect(await probeServicePresence(layer)).toBe(false);
  });

  it("(f) absent without memory — wire-when-memory-enabled policy", async () => {
    // No memory layer = MemoryDatabase absent = SkillStoreServiceLive can't satisfy.
    // Policy: even with skillPersistence:true, do not force-wire.
    const layer = createRuntime({
      agentId: "skill-nomem-agent",
      provider: "test",
      enableMemory: false,
      skillPersistence: true,
    });

    expect(await probeServicePresence(layer)).toBe(false);
  });

  it("(g) cross-session recall — skill stored in session A is recoverable in session B sharing dbPath", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-skill-xsession-"));
    const dbPath = path.join(tmpDir, "skills.db");
    const agentId = "xsession-agent";

    const makeLayer = () =>
      createRuntime({
        agentId,
        provider: "test",
        enableMemory: true,
        memoryOptions: { dbPath },
        skillPersistence: true,
      });

    const sampleSkill: SkillRecord = {
      id: "xsession-skill-1",
      name: "xsession-test-skill",
      description: "Skill stored in session A to be recalled in session B",
      agentId,
      source: "learned",
      instructions: "Do the thing reliably.",
      version: 1,
      versionHistory: [],
      config: {
        strategy: "reactive",
        temperature: 0.7,
        maxIterations: 5,
        promptTemplateId: "default",
        systemPromptTokens: 0,
        compressionEnabled: false,
      },
      evolutionMode: "auto",
      confidence: "trusted",
      successRate: 0.9,
      useCount: 7,
      refinementCount: 0,
      taskCategories: ["xsession"],
      modelAffinities: [],
      base: null,
      avgPostActivationEntropyDelta: 0,
      avgConvergenceIteration: 0,
      convergenceSpeedTrend: [],
      conflictsWith: [],
      lastActivatedAt: null,
      lastRefinedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contentVariants: {
        full: "Do the thing reliably.",
        summary: null,
        condensed: null,
      },
    };

    // ── Session A: store the skill, then dispose ──
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* SkillStoreService;
          yield* store.store(sampleSkill);
        }).pipe(Effect.provide(makeLayer() as Layer.Layer<any>)),
      ),
    );

    expect(fs.existsSync(dbPath)).toBe(true);

    // ── Session B: rebuild runtime with same dbPath, listAll recovers the skill ──
    const recalled = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* SkillStoreService;
          return yield* store.listAll(agentId);
        }).pipe(Effect.provide(makeLayer() as Layer.Layer<any>)),
      ),
    );

    expect(recalled.length).toBe(1);
    expect(recalled[0]!.id).toBe("xsession-skill-1");
    expect(recalled[0]!.name).toBe("xsession-test-skill");
    expect(recalled[0]!.agentId).toBe(agentId);
  }, 30000);
});
