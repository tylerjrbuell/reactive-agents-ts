/**
 * Example 07: Cross-Session Skill Recall
 *
 * Witnesses the `.withSkillPersistence()` + `.withMemory({ dbPath })` surfaces
 * (HS-122, shipped in `packages/runtime/src/builder.ts:817` and wired through
 * `packages/runtime/src/runtime.ts:1372`).
 *
 * Pass criterion: a skill installed by **agent #1** into a shared SQLite memory
 * DB is recalled by **agent #2** that points at the same `dbPath` — proving the
 * SkillStoreService write path is durable across process-equivalent sessions
 * and that the recall layer surfaces it on the second agent (M6 KEEP graduation).
 *
 * NB on the test provider: the reactive-intelligence learning engine short-
 * circuits skill synthesis for `provider === "test"` runs
 * (see learning-engine.ts:95-103). To exercise persistence deterministically,
 * this example uses `agent.loadSkill(path)` — the canonical public install
 * surface — which bypasses synthesis and writes directly to the SkillStore.
 * Cross-session readback via `agent.skills()` is still the witnessed assertion.
 *
 * Usage:
 *   bun run apps/examples/src/foundations/07-cross-session-skill-recall.ts
 */

import { ReactiveAgents } from "reactive-agents";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? "test") as PN;

  console.log("=== Reactive Agents: Cross-Session Skill Recall Example ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // Isolated tmp dir so reruns don't pollute / dirty state can't leak in
  const workDir = mkdtempSync(join(tmpdir(), "ra-skill-recall-"));
  const dbPath = join(workDir, "skills.db");
  const skillDir = join(workDir, "naming-convention");
  mkdirSync(skillDir, { recursive: true });

  // Author a minimal SKILL.md (YAML frontmatter + body — see
  // packages/reactive-intelligence/src/skills/skill-registry.ts:119)
  const skillMd = [
    "---",
    "name: naming-convention",
    "description: Names APIs in screaming-kebab-case for this project.",
    "---",
    "",
    "When introducing a new identifier in this codebase, always use",
    "SCREAMING-KEBAB-CASE for public-API symbols.",
    "",
  ].join("\n");
  writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf-8");

  let agent1Skills = 0;
  let agent2Skills = 0;
  let recalledName = "";

  try {
    // Shared stable ID so both sessions key into the same skill rows.
    // Skill rows are scoped by `agent_id` in @reactive-agents/memory's
    // skill-store.ts:366 — without .withAgentId(), each build() mints a fresh
    // `${name}-${Date.now()}` ID and the second agent would see zero skills.
    const stableId = `cross-session-demo-${Date.now()}`;

    // ── Session 1 — install the skill ──────────────────────────────────────
    console.log("─── Session 1: install skill ───");
    const a1Builder = ReactiveAgents.create()
      .withName("session-1")
      .withAgentId(stableId)
      .withProvider(provider)
      .withMemory({ tier: "enhanced", dbPath })
      .withSkillPersistence();
    if (opts?.model) a1Builder.withModel(opts.model);
    if (provider === "test") {
      a1Builder.withTestScenario([
        { text: "FINAL ANSWER: Skill installed." },
      ]);
    }
    const agent1 = await a1Builder.withMaxIterations(2).build();

    await agent1.loadSkill(skillDir);
    const skills1 = await agent1.skills();
    agent1Skills = skills1.length;
    console.log(`Agent #1 sees ${agent1Skills} skill(s) after install.`);
    if (skills1[0]) console.log(`  - ${skills1[0].name}: ${skills1[0].description}`);

    await agent1.dispose();
    console.log("Agent #1 disposed.\n");

    // ── Session 2 — fresh agent, same dbPath ───────────────────────────────
    console.log("─── Session 2: recall from same dbPath ───");
    const a2Builder = ReactiveAgents.create()
      .withName("session-2")
      .withAgentId(stableId)
      .withProvider(provider)
      .withMemory({ tier: "enhanced", dbPath })
      .withSkillPersistence();
    if (opts?.model) a2Builder.withModel(opts.model);
    if (provider === "test") {
      a2Builder.withTestScenario([
        { text: "FINAL ANSWER: Reading recalled skills." },
      ]);
    }
    const agent2 = await a2Builder.withMaxIterations(2).build();

    const skills2 = await agent2.skills();
    agent2Skills = skills2.length;
    const recalled = skills2.find((s) => s.name === "naming-convention");
    recalledName = recalled?.name ?? "";
    console.log(`Agent #2 sees ${agent2Skills} skill(s) on fresh boot.`);
    if (recalled) console.log(`  ✅ Recalled: ${recalled.name} (source=${recalled.source})`);
    else console.log("  ❌ skill 'naming-convention' NOT recalled across sessions");

    // Drive one run so the harness records the steps/tokens metadata shape
    const r2 = await agent2.run("Confirm the recalled skill.");
    await agent2.dispose();

    const passed =
      agent1Skills >= 1 &&
      agent2Skills >= 1 &&
      recalledName === "naming-convention";

    return {
      passed,
      output: passed
        ? `Cross-session recall OK: '${recalledName}' survived dispose+rebuild.`
        : `recall failed (agent1=${agent1Skills}, agent2=${agent2Skills})`,
      steps: r2.metadata.stepsCount,
      tokens: r2.metadata.tokensUsed,
      durationMs: Date.now() - start,
    };
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
