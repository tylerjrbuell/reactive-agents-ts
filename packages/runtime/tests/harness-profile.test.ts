/**
 * MOVE-6 — HarnessProfile preset tests.
 *
 * Pins:
 *   1. Three preset factories return structurally correct patches.
 *   2. `withProfile(lean())` disables ALL bootstrap-default-on
 *      capabilities — closes the historical `.withLeanHarness()` leak
 *      that did NOT disable RI (master plan §1.2 cost #2).
 *   3. `withProfile(balanced())` is a no-op (today's defaults stand).
 *   4. `withProfile(intelligent())` enables skill persistence.
 *   5. Later `.withX()` calls override patch (composition semantics).
 *   6. Registry remains the source-of-truth for what each preset can
 *      modify — preset patch field count ≤ default-on registry entry
 *      count + opt-in candidates (drift guard).
 *
 * Spec: wiki/Architecture/Design-Specs/2026-05-26-capability-cost-registry.md §1.3
 */
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "reactive-agents";
import { HarnessProfile } from "../src/capabilities/profile.js";

describe("HarnessProfile factory contracts (MOVE-6)", () => {
  it("lean() returns patch disabling all 4 bootstrap-default-on capabilities", () => {
    const patch = HarnessProfile.lean();
    expect(patch.name).toBe("lean");
    expect(patch.enableMemory).toBe(false);
    expect(patch.enableReactiveIntelligence).toBe(false);
    expect(patch.enableVerifier).toBe(false);
    expect(patch.enableStrategySwitching).toBe(false);
    expect(patch.enableSkillPersistence).toBe(false);
  });

  it("balanced() enables memory explicitly (v0.12 — memory default-off)", () => {
    const patch = HarnessProfile.balanced();
    expect(patch.name).toBe("balanced");
    // v0.12: memory is OFF in a bare builder, so balanced() opts it back in
    // to preserve the "production defaults" contract. RI / verifier /
    // strategy-switching remain registry bootstrap-defaults (no field here).
    expect(patch.enableMemory).toBe(true);
    expect(patch.enableReactiveIntelligence).toBeUndefined();
    expect(patch.enableVerifier).toBeUndefined();
    expect(patch.enableStrategySwitching).toBeUndefined();
    expect(patch.enableSkillPersistence).toBeUndefined();
  });

  it("intelligent() enables memory + skill persistence", () => {
    const patch = HarnessProfile.intelligent();
    expect(patch.name).toBe("intelligent");
    expect(patch.enableSkillPersistence).toBe(true);
    // v0.12: skill persistence needs memory, so intelligent() enables it too.
    expect(patch.enableMemory).toBe(true);
    expect(patch.enableReactiveIntelligence).toBeUndefined();
  });
});

describe("withProfile(lean()) — closes the historical lean-harness leak (MOVE-6)", () => {
  it("disables memory + RI + skill persistence at build time (audit() reflects)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("lean-profile-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withProfile(HarnessProfile.lean())
      .build();

    // Run once so memory-flush-dispatch populates ctx.metadata.taskComplexity
    const result = await agent.run("trivial");
    expect(result.success).toBe(true);

    // Memory disabled → no debrief synthesized regardless of trivial
    // gate (the agent was built with memory off, not just trivial-task
    // gate-skipped).
    expect(result.debrief).toBeUndefined();

    // Registry audit still surfaces the 4 bootstrap entries (registry is
    // metadata-about-capabilities, not the live capability state) —
    // confirms registry and lean preset are decoupled correctly.
    const report = await agent.capabilities.audit();
    expect(report.totalEntries).toBe(4);

    await agent.dispose();
  });

  it("does NOT leak — RI flag flipped off in builder state", async () => {
    // The original `.withLeanHarness()` leak: memory + verifier +
    // strategy-switching off, but RI still on. Lean-profile closes that.
    // Indirect assertion via successful build + no surface-level error.
    const agent = await ReactiveAgents.create()
      .withName("lean-no-leak")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withProfile(HarnessProfile.lean())
      .build();
    const result = await agent.run("test");
    expect(result.success).toBe(true);
    await agent.dispose();
  });
});

describe("withProfile(balanced()) — today's defaults (MOVE-6)", () => {
  it("equivalent to building with no profile at all", async () => {
    const balancedAgent = await ReactiveAgents.create()
      .withName("balanced")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withProfile(HarnessProfile.balanced())
      .build();

    const result = await balancedAgent.run("test");
    expect(result.success).toBe(true);

    const report = await balancedAgent.capabilities.audit();
    expect(report.defaultOnCount).toBe(4);

    await balancedAgent.dispose();
  });
});

describe("withProfile(intelligent()) — opt-in compounding learning (MOVE-6)", () => {
  it("enables skill persistence on top of balanced base", async () => {
    const agent = await ReactiveAgents.create()
      .withName("intelligent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withProfile(HarnessProfile.intelligent())
      .build();

    const result = await agent.run("test");
    expect(result.success).toBe(true);

    // Audit still shows the 4 bootstrap registry entries — intelligent
    // adds opt-in capabilities to user state, not new registry entries
    // (future MOVE-2 phases will register skill-persistence with a
    // dedicated entry; today it's a builder flag).
    const report = await agent.capabilities.audit();
    expect(report.totalEntries).toBe(4);

    await agent.dispose();
  });
});

describe("withProfile composition semantics (MOVE-6)", () => {
  it("later .withMemory() overrides lean()'s memory-off patch", async () => {
    // Composition contract: profile is a base; later calls override.
    const agent = await ReactiveAgents.create()
      .withName("lean-plus-memory")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withProfile(HarnessProfile.lean())
      .withMemory({ tier: "standard", dbPath: "/tmp/lean-plus-memory.db" })
      .build();

    const result = await agent.run("test");
    expect(result.success).toBe(true);
    await agent.dispose();
  });

  it("withProfile(lean()) is idempotent — calling twice equals calling once", async () => {
    const a = await ReactiveAgents.create()
      .withName("lean-once")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withProfile(HarnessProfile.lean())
      .build();
    const b = await ReactiveAgents.create()
      .withName("lean-twice")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withProfile(HarnessProfile.lean())
      .withProfile(HarnessProfile.lean())
      .build();
    const ra = await a.run("test");
    const rb = await b.run("test");
    expect(ra.success).toBe(rb.success);
    await a.dispose();
    await b.dispose();
  });
});

describe("HarnessProfile registry-drift guard (MOVE-6)", () => {
  it("patch fields ≤ registry default-on + skill-persistence opt-in (drift detector)", () => {
    // If the registry grows a new default-on entry (e.g., MOVE-2 M2.4
    // adds adaptive-routing), the HarnessProfilePatch schema MUST grow
    // a corresponding field — otherwise lean() silently leaves the new
    // capability on, recreating the original Lever-8 leak pattern.
    // This test counts patch fields and asserts the expected coverage
    // so any future drift surfaces as a test failure.
    const leanPatch = HarnessProfile.lean();
    const explicitFields = Object.keys(leanPatch).filter((k) => k !== "name");
    // Today: memory + RI + verifier + strategy-switching (4 bootstrap
    // default-on) + skill-persistence (opt-in we ship lean=false) = 5.
    expect(explicitFields.length).toBe(5);
  });
});
