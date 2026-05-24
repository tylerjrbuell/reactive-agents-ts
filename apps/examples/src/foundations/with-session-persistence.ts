/**
 * Aspirational Example (xfail target): `.withSessionPersistence()` builder method
 *
 * GAP STATEMENT
 *   withSessionPersistence builder surface missing; SessionStoreServiceLive wired
 *   in runtime.ts (packages/runtime/src/runtime.ts:1354-1362) but no chainable
 *   builder hook to enable it. Sibling .withSkillPersistence() shipped in HS-122
 *   at packages/runtime/src/builder.ts:817 — this is the missing parity hook.
 *
 * SPEC (executable witness — must pass once the feature ships):
 *   const a1 = await ReactiveAgents.create()
 *     .withMemory({ dbPath: "/tmp/sessions.db" })
 *     .withSessionPersistence()        // ← missing chainable today
 *     .withAgentId("stable-id")
 *     .build();
 *   await a1.run("turn 1: my name is X");
 *
 *   // new process / new agent
 *   const a2 = await ReactiveAgents.create()
 *     .withMemory({ dbPath: "/tmp/sessions.db" })
 *     .withSessionPersistence()
 *     .withAgentId("stable-id")
 *     .build();
 *   const r = await a2.run("turn 2: what's my name?");
 *   // expect r.output to contain "X"
 *
 * When the builder hook ships and cross-session recall works:
 *   1. r.output contains the prior turn's content (case-insensitive substring).
 *   2. Drop `expectsFail: true` in apps/examples/index.ts in the same commit.
 *
 * Usage:
 *   bun run apps/examples/src/foundations/with-session-persistence.ts
 */

import { ReactiveAgents } from "reactive-agents";
import { existsSync, unlinkSync } from "node:fs";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

const DB_PATH = "/tmp/with-session-persistence.xfail.db";

export async function run(_opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  console.log("=== Aspirational: .withSessionPersistence() ===\n");

  // best-effort cleanup of any prior run
  for (const p of [DB_PATH, `${DB_PATH}-shm`, `${DB_PATH}-wal`]) {
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }

  const AGENT_ID = "xfail-session-stable-id";

  const probe = (ReactiveAgents.create() as any);
  if (typeof probe.withSessionPersistence !== "function") {
    return {
      passed: false,
      output:
        "withSessionPersistence builder surface missing; SessionStoreServiceLive " +
        "wired in runtime.ts but no chainable builder hook to enable it. " +
        "Mirror .withSkillPersistence() (builder.ts:817) for parity.",
      steps: 0,
      tokens: 0,
      durationMs: Date.now() - start,
    };
  }

  // Hook exists — verify cross-session recall actually works.
  try {
    const a1 = await (ReactiveAgents.create() as any)
      .withName("xfail-session-a1")
      .withProvider("test")
      .withTestScenario([{ match: "my name is", text: "Noted: your name is Xavier." }])
      .withMemory({ dbPath: DB_PATH })
      .withSessionPersistence()
      .withAgentId(AGENT_ID)
      .withMaxIterations(2)
      .build();
    await a1.run("turn 1: my name is Xavier");

    const a2 = await (ReactiveAgents.create() as any)
      .withName("xfail-session-a2")
      .withProvider("test")
      .withTestScenario([{ match: "name", text: "Your name is Xavier." }])
      .withMemory({ dbPath: DB_PATH })
      .withSessionPersistence()
      .withAgentId(AGENT_ID)
      .withMaxIterations(2)
      .build();
    const r = await a2.run("turn 2: what's my name?");

    const recalled = String(r?.output ?? "").toLowerCase().includes("xavier");
    return {
      passed: recalled,
      output: recalled
        ? `Cross-session recall works: a2 recovered "Xavier" from prior session via ${DB_PATH}.`
        : `withSessionPersistence() exists but cross-session recall did not surface prior turn — output=${JSON.stringify(r?.output)}.`,
      steps: r?.metadata?.stepsCount ?? 0,
      tokens: r?.metadata?.tokensUsed ?? 0,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      passed: false,
      output: `withSessionPersistence flow threw: ${(err as Error).message}`,
      steps: 0,
      tokens: 0,
      durationMs: Date.now() - start,
    };
  } finally {
    for (const p of [DB_PATH, `${DB_PATH}-shm`, `${DB_PATH}-wal`]) {
      try { if (existsSync(p)) unlinkSync(p); } catch {}
    }
  }
}

if (import.meta.main) {
  run().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.passed ? 0 : 1);
  });
}
