#!/usr/bin/env bun
/**
 * Capture ONE real, fully-instrumented agent run to power the docs landing
 * page: hero, "see it run", trust receipt, debrief, and lifecycle-hooks
 * sections all read from the SAME run instead of disconnected snippets.
 *
 * Model: gemma4:e4b via Ollama (~4B-class local, no API key) — matches the
 * model already cited in the existing receipt for narrative consistency.
 *
 * Env: GOLDEN_MODE=success|failed (failed = iteration cap GOLDEN_MAX_ITER, default 2), GOLDEN_OUT=<path>.
 * Output: $GOLDEN_OUT, default /tmp/golden-run.json (result + hook log), plus whatever
 * ~/.reactive-agents/traces/<runId>.jsonl the framework writes automatically
 * (tracing is on by default).
 */
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { GOLDEN_MODEL, GOLDEN_PROVIDER, GOLDEN_TASK, applyGoldenBuilder, goldenBuilderLines } from "./golden-run-builder.js";

const repoRoot = join(import.meta.dirname, "../../..");
const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { cwd: repoRoot, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
};
const ollamaVersion = async (): Promise<string> => {
  try {
    const r = await fetch("http://localhost:11434/api/version");
    return ((await r.json()) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
};

const workDir = mkdtempSync(join(tmpdir(), "ra-golden-"));

type HookLogEntry = {
  phase: string;
  timing: "before" | "after";
  t: number;
  iter?: number;
};
const hookLog: HookLogEntry[] = [];

const PHASES = [
  "bootstrap",
  "guardrail",
  "cost-route",
  "strategy-select",
  "think",
  "act",
  "observe",
  "verify",
  "memory-flush",
  "cost-track",
  "audit",
  "complete",
] as const;

async function main() {
  // Throwaway Ed25519 key, in memory only. Never written, printed or committed.
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

  const mode = process.env.GOLDEN_MODE === "failed" ? "failed" : "success";
  const maxIterations = mode === "failed" ? Number(process.env.GOLDEN_MAX_ITER ?? "2") : undefined;
  // The chain lives in golden-run-builder.ts so the docs snippet cannot drift.
  let builder = applyGoldenBuilder(ReactiveAgents.create(), { privateKeyJwk, maxIterations });

  for (const phase of PHASES) {
    for (const timing of ["before", "after"] as const) {
      builder = builder.withHook({
        phase,
        timing,
        handler: (ctx: { metadata?: { stepsCount?: number } }) => {
          hookLog.push({
            phase,
            timing,
            t: Date.now(),
            iter: ctx?.metadata?.stepsCount,
          });
        },
      });
    }
  }

  const agent = await builder.build();

  const task = GOLDEN_TASK;

  process.chdir(workDir);
  const t0 = Date.now();
  const result = await agent.run(task);
  const wallMs = Date.now() - t0;

  const out = {
    task,
    workDir,
    model: { id: GOLDEN_MODEL, provider: GOLDEN_PROVIDER, tier: "local" },
    capture: {
      mode,
      maxIterations: maxIterations ?? null,
      capturedAt: new Date().toISOString().slice(0, 10),
      frameworkVersion: sh("cat VERSION"),
      gitDescribe: sh("git describe --always"),
      ollamaVersion: await ollamaVersion(),
      builderLines: goldenBuilderLines(),
    },
    wallMs,
    hookLog,
    result: {
      success: result.success,
      output: result.output,
      metadata: result.metadata,
      receipt: result.receipt,
      debrief: result.debrief,
      debriefRich: await (result as { debriefRich?: () => Promise<unknown> }).debriefRich?.(),
    },
  };

  const outPath = process.env.GOLDEN_OUT ?? "/tmp/golden-run.json";
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("[golden-run] wrote", outPath);
  console.log("[golden-run] runId:", (result.metadata as { runId?: string })?.runId);
  console.log("[golden-run] verdict:", result.receipt?.verdict);
  console.log("[golden-run] hookLog entries:", hookLog.length);

  // Surface generated files for sanity check
  try {
    const files = readdirSync(workDir);
    console.log("[golden-run] workDir files:", files);
    for (const f of files) {
      console.log(`--- ${f} ---`);
      console.log(readFileSync(join(workDir, f), "utf-8").slice(0, 400));
    }
  } catch (e) {
    console.error("[golden-run] workDir read failed:", e);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("[golden-run] FAILED:", e);
  process.exit(1);
});
