/**
 * MOVE-2 M2.1 — CapabilityRegistry tests.
 *
 * Pins:
 *   1. Registry CRUD (register / get / list / defaultOnEntries / audit)
 *   2. Bootstrap entries present at Layer construction time (4 entries:
 *      memory, reactive-intelligence, verifier, strategy-switching)
 *   3. `strategy-switching` deliberately ships with `liftEvidence: null`
 *      per spec §3.4 — appears in `audit().violations`. This is the
 *      registry's first load-bearing signal; ablation-warden gate (M2.3)
 *      will enforce.
 *   4. `agent.capabilities.audit()` integration — surfaces registry to
 *      user-facing API; closes the §9 Anti-Scaffold gap.
 *   5. Staleness threshold honors override.
 *
 * Spec: wiki/Architecture/Design-Specs/2026-05-26-capability-cost-registry.md
 */
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { ReactiveAgents } from "reactive-agents";
import {
  CapabilityRegistry,
  CapabilityRegistryLive,
  CapabilityNotFoundError,
  bootstrapEntries,
  type CapabilityEntry,
} from "../src/capabilities/registry.js";

const futureNow = new Date("2027-01-01T00:00:00.000Z");

describe("CapabilityRegistry — service tag CRUD (M2.1)", () => {
  it("bootstrap registers 4 initial entries", async () => {
    const entries = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.list();
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(entries.length).toBe(4);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual([
      "memory",
      "reactive-intelligence",
      "strategy-switching",
      "verifier",
    ]);
  });

  it("`defaultOnEntries()` returns only entries with defaultOn=true", async () => {
    const entries = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.defaultOnEntries();
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(entries.length).toBe(4); // all 4 bootstrap entries are default-on
    for (const e of entries) {
      expect(e.defaultOn).toBe(true);
    }
  });

  it("`get(name)` returns entry or fails with CapabilityNotFoundError", async () => {
    const memEntry = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.get("memory");
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(memEntry.name).toBe("memory");
    expect(memEntry.ownerWarden).toBe("memory");

    const missingResult = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.get("does-not-exist");
      })
        .pipe(Effect.provide(CapabilityRegistryLive))
        .pipe(Effect.either),
    );
    expect(missingResult._tag).toBe("Left");
    if (missingResult._tag === "Left") {
      expect(missingResult.left).toBeInstanceOf(CapabilityNotFoundError);
    }
  });

  it("`register(entry)` overwrites by name (idempotent)", async () => {
    const custom: CapabilityEntry = {
      name: "memory",
      description: "overridden",
      defaultOn: false,
      costSignature: { tokensPerRun: 0, latencyPerRunMs: 0, extraLLMCalls: 0 },
      liftEvidence: null,
      riskNotes: "test",
      rationale: "test",
      ownerWarden: "runtime",
      lastAblation: null,
    };
    const after = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        yield* reg.register(custom);
        return yield* reg.get("memory");
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(after.description).toBe("overridden");
    expect(after.defaultOn).toBe(false);
  });
});

describe("CapabilityRegistry — audit() report (M2.1)", () => {
  it("flags `strategy-switching` as a violation (default-on + null lift evidence)", async () => {
    // Spec §3.4 — deliberate load-bearing signal: the registry's first
    // surfaced gate violation, forcing the ablation-warden CI (M2.3) to
    // either gather evidence or convert to opt-in.
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.audit();
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(report.violations.length).toBe(1);
    expect(report.violations[0]?.name).toBe("strategy-switching");
    expect(report.violations[0]?.defaultOn).toBe(true);
    expect(report.violations[0]?.liftEvidence).toBeNull();
  });

  it("counts defaultOn entries + total entries correctly", async () => {
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.audit();
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(report.totalEntries).toBe(4);
    expect(report.defaultOnCount).toBe(4);
  });

  it("groups entries by warden", async () => {
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.audit();
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(report.byWarden.memory?.length).toBe(1);
    expect(report.byWarden["reactive-intelligence"]?.length).toBe(1);
    expect(report.byWarden.kernel?.length).toBe(1); // verifier
    expect(report.byWarden.runtime?.length).toBe(1); // strategy-switching
  });

  it("staleEntries honors override threshold (90d default → flag all 4 when now=2027)", async () => {
    // All bootstrap entries were measured in May 2026; from a 2027-01-01
    // viewpoint, every dated entry is > 90d old. strategy-switching has
    // null lastAblation and is excluded (cannot be stale if never measured).
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.audit({ now: futureNow });
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(report.staleEntries.length).toBe(3);
    expect(report.staleEntries.map((e) => e.name).sort()).toEqual([
      "memory",
      "reactive-intelligence",
      "verifier",
    ]);
  });

  it("staleEntries empty when threshold larger than all entry ages", async () => {
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.audit({ staleThresholdDays: 100000, now: futureNow });
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(report.staleEntries.length).toBe(0);
  });
});

describe("bootstrap entries — schema invariants (M2.1)", () => {
  it("every defaultOn=true entry except strategy-switching carries liftEvidence", () => {
    // strategy-switching = the one deliberate exception per spec §3.4.
    // All other default-on entries must have non-null liftEvidence per the
    // M2.3 gate that will enforce this once shipped.
    for (const e of bootstrapEntries) {
      if (e.defaultOn && e.name !== "strategy-switching") {
        expect(e.liftEvidence).not.toBeNull();
        expect(e.liftEvidence?.measuredOn.length ?? 0).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("every entry has a stable `name`, `description`, `rationale`, `ownerWarden`", () => {
    for (const e of bootstrapEntries) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.rationale.length).toBeGreaterThan(0);
      expect(e.ownerWarden.length).toBeGreaterThan(0);
    }
  });
});

describe("agent.capabilities.audit() — runtime integration (M2.2 in same commit per Anti-Scaffold)", () => {
  it("returns a populated CapabilityAuditReport from a default build", async () => {
    // Anti-Scaffold satisfied (master plan §9): the registry is wired into
    // the runtime Layer AND has a user-facing consumer in the SAME commit.
    const agent = await ReactiveAgents.create()
      .withName("capability-audit-test")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .build();

    const report = await agent.capabilities.audit();

    // 4 bootstrap entries present, all default-on
    expect(report.totalEntries).toBe(4);
    expect(report.defaultOnCount).toBe(4);

    // strategy-switching violation surfaces
    expect(report.violations.length).toBe(1);
    expect(report.violations[0]?.name).toBe("strategy-switching");

    // Stable structure for downstream consumers
    expect(Array.isArray(report.entries)).toBe(true);
    expect(Array.isArray(report.staleEntries)).toBe(true);
    expect(typeof report.byWarden).toBe("object");

    await agent.dispose();
  });

  it("audit() can be called multiple times — registry is shared across calls", async () => {
    const agent = await ReactiveAgents.create()
      .withName("capability-audit-idempotent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .build();

    const r1 = await agent.capabilities.audit();
    const r2 = await agent.capabilities.audit();

    expect(r1.totalEntries).toBe(r2.totalEntries);
    expect(r1.violations.length).toBe(r2.violations.length);

    await agent.dispose();
  });
});
