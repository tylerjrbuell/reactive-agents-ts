/**
 * MOVE-2 M2.1 — CapabilityRegistry tests.
 *
 * Pins:
 *   1. Registry CRUD (register / get / list / defaultOnEntries / audit)
 *   2. Bootstrap entries present at Layer construction time (4 entries:
 *      memory, reactive-intelligence, verifier, strategy-switching)
 *   3. `strategy-switching` first shipped default-on with
 *      `liftEvidence: null` per spec §3.4 (the registry's first
 *      load-bearing signal). The 2026-11-05 ablation returned OPT-IN, so
 *      it is now default-off with recorded evidence and the bootstrap
 *      audit reports zero violations.
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
    // Wave 6.5: memory flipped to default-off (stateless default).
    // 2026-11-05: strategy-switching flipped to opt-in (ablation OPT-IN).
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.name).sort()).toEqual(["reactive-intelligence", "verifier"]);
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
  it("`strategy-switching` is opt-in with recorded ablation evidence (no violations)", async () => {
    // Spec §3.4 signal resolved: the gate ran (2026-11-05) and returned
    // OPT-IN, so the entry converted to default-off with its evidence.
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.audit();
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(report.violations.length).toBe(0);
    const entry = report.entries.find((e) => e.name === "strategy-switching");
    expect(entry?.defaultOn).toBe(false);
    expect(entry?.liftEvidence?.evidence).toBe(
      "wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md",
    );
    expect(entry?.lastAblation).toBe("2026-11-05");
  });

  it("a default-on entry with null lift evidence is still flagged as a violation", async () => {
    // The gate itself stays load-bearing even with no bootstrap violation.
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        yield* reg.register({
          name: "unproven",
          description: "default-on with no evidence",
          defaultOn: true,
          costSignature: { tokensPerRun: 0, latencyPerRunMs: 0, extraLLMCalls: 0 },
          liftEvidence: null,
          riskNotes: "test",
          rationale: "test",
          ownerWarden: "runtime",
          lastAblation: null,
        });
        return yield* reg.audit();
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(report.violations.map((e) => e.name)).toEqual(["unproven"]);
  });

  it("counts defaultOn entries + total entries correctly", async () => {
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg.audit();
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(report.totalEntries).toBe(4);
    expect(report.defaultOnCount).toBe(2); // memory (Wave 6.5) + strategy-switching (2026-11-05) are opt-in
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

  it("staleEntries honors override threshold (90d default → flag the May-2026 entries when now=2027)", async () => {
    // memory / RI / verifier were measured in May 2026; from a 2027-01-01
    // viewpoint they are > 90d old. strategy-switching was measured
    // 2026-11-05 (57d before 2027-01-01) and is not yet stale.
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
  it("every defaultOn=true entry carries liftEvidence (no exceptions)", () => {
    // The spec §3.4 exception (strategy-switching) was resolved 2026-11-05
    // by flipping it to opt-in, so the rule now holds for every entry.
    for (const e of bootstrapEntries) {
      if (e.defaultOn) {
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

    // 4 bootstrap entries present; memory + strategy-switching are opt-in
    expect(report.totalEntries).toBe(4);
    expect(report.defaultOnCount).toBe(2);

    // No default-on entry lacks lift evidence
    expect(report.violations.length).toBe(0);

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

describe("CapabilityRegistry — recordLiftEvidence (Wave 7.2 feed)", () => {
  it("writes measured evidence onto an entry and clears its violation", async () => {
    const after = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        yield* reg.recordLiftEvidence(
          "strategy-switching",
          {
            measuredOn: ["local", "mid"],
            averageDelta: "+testpp measured",
            evidence: "wiki/Research/Harness-Reports/2026-10-12-program-scoreboard.md",
            measuredAt: "2026-10-14",
          },
          new Date("2026-10-14T00:00:00Z"),
        );
        return yield* reg.get("strategy-switching");
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(after.liftEvidence?.averageDelta).toBe("+testpp measured");
    expect(after.liftEvidence?.measuredOn).toEqual(["local", "mid"]);
    expect(after.lastAblation).toBe("2026-10-14");
    // Untouched fields survive the read-modify-write.
    expect(after.defaultOn).toBe(false);
    expect(after.description.length).toBeGreaterThan(0);
  });

  it("fails CapabilityNotFoundError on unknown names (no evidence for nothing)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* CapabilityRegistry;
        return yield* reg
          .recordLiftEvidence("no-such-capability", {
            measuredOn: ["local"],
            averageDelta: "x",
            evidence: "y",
            measuredAt: "2026-10-14",
          })
          .pipe(Effect.either);
      }).pipe(Effect.provide(CapabilityRegistryLive)),
    );
    expect(result._tag).toBe("Left");
  });
});
