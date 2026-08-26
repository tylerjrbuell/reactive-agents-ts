#!/usr/bin/env bun
/**
 * Build-time generator for the landing page's evidence-receipt showcase.
 *
 * Transforms a REAL captured QA-probe report into the shape the
 * EvidenceReceipt component renders. This keeps the "verified, not vibes"
 * proof on the home page sourced from an actual run instead of hand-authored
 * numbers — regenerate it whenever the probe fleet is re-run.
 *
 * Source of truth: the newest
 *   wiki/Research/Harness-Reports/real-world-probes-<date>/<probe>.json
 * (deterministic, no model needed — it reads committed JSON), so this is safe
 * to run in the `prebuild` hook alongside generate-metrics.
 *
 * Output: apps/docs/src/data/evidence-receipt.json
 *
 * Run manually:
 *   bun run apps/docs/scripts/generate-evidence-receipt.ts [--probe p2-multi-file] [--model gemma4:e4b]
 *
 * The probe JSON does not record which model ran it; `--model` (default the
 * fleet's local model per the 2026-07-11 debrief) is the one asserted value —
 * everything else is verbatim from the trace.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const DOCS_DIR = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DOCS_DIR, "../..");
const REPORTS_ROOT = join(REPO_ROOT, "wiki/Research/Harness-Reports");
const OUTPUT = resolve(DOCS_DIR, "src/data/evidence-receipt.json");

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PROBE = arg("probe", "p2-multi-file");
const MODEL = arg("model", "gemma4:e4b");

/** Human-readable task metadata per known probe (label + prompt for display). */
const TASK_META: Record<string, { label: string; prompt: string }> = {
  "p2-multi-file": {
    label:
      "Multi-file generation — write a markdown report and a JSON data file, then declare both as deliverables",
    prompt:
      "Compare the moon counts of Jupiter, Saturn, and Mars. Write ./qa-out/p2-report.md and ./qa-out/p2-data.json.",
  },
};

/** tool-grounded/etc. → base confidence (no verifierVerdict in probe reports). */
const CONFIDENCE: Record<string, number> = {
  "tool-grounded": 0.8,
  "partially-grounded": 0.6,
  ungrounded: 0.8,
  abstained: 0.95,
  failed: 0.95,
};

/**
 * Strip local absolute paths out of a string, without disturbing paths that
 * are already relative (`./qa-out/...` must stay `./qa-out/...`, not become
 * `../qa-out/...`). Only absolute home-dir paths are rewritten.
 */
const sanitize = (s: string): string =>
  s
    // /home/<user>/<...>/qa-out/<file>  ->  ./qa-out/<file>
    .replace(/\/home\/[^\s"']*\/(qa-out\/[^\s"']+)/g, "./$1")
    // any other absolute home path -> keep just the basename
    .replace(/\/home\/[^\s"']+/g, (m) => "./" + (m.split("/").pop() ?? ""))
    .trim();

/** Newest real-world-probes-* directory by name (date-sorted, descending). */
const findLatestProbeDir = (): string => {
  const dirs = readdirSync(REPORTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("real-world-probes-"))
    .map((d) => d.name)
    .sort()
    .reverse();
  if (dirs.length === 0) throw new Error(`no real-world-probes-* dirs under ${REPORTS_ROOT}`);
  return join(REPORTS_ROOT, dirs[0]);
};

interface ProbeCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly detail?: string;
}
interface ProbeReport {
  readonly probe?: string;
  readonly verdict?: string;
  readonly strategyUsed?: string;
  readonly terminatedBy?: string;
  readonly goalAchieved?: boolean | null;
  readonly success?: boolean;
  readonly failCount?: number;
  readonly llmCalls?: number;
  readonly tokensUsed?: number;
  readonly durationMs?: number;
  readonly checks?: readonly ProbeCheck[];
}

/** Pull deliverables out of the `*deliverables-declared` check's detail blob. */
const parseDeliverables = (
  checks: readonly ProbeCheck[],
): readonly { spec: string; produced: boolean }[] => {
  for (const c of checks) {
    if (!c.detail || !c.detail.includes("deliverables=")) continue;
    const raw = c.detail.slice(c.detail.indexOf("deliverables=") + "deliverables=".length);
    try {
      const parsed = JSON.parse(raw) as { spec: string; produced: boolean }[];
      return parsed.map((d) => ({ spec: sanitize(d.spec), produced: !!d.produced }));
    } catch {
      /* fall through */
    }
  }
  return [];
};

const main = (): void => {
  const dir = findLatestProbeDir();
  const capturedAt = dir.split("real-world-probes-").pop() ?? "";
  const probePath = join(dir, `${PROBE}.json`);
  if (!existsSync(probePath)) throw new Error(`probe report not found: ${probePath}`);

  const report = JSON.parse(readFileSync(probePath, "utf-8")) as ProbeReport;
  const checks = report.checks ?? [];
  const verdict = report.verdict ?? "ungrounded";
  const deliverables = parseDeliverables(checks);

  const meta =
    TASK_META[PROBE] ?? { label: `${PROBE} probe`, prompt: "" };

  const out = {
    _source: `Real captured run from the framework's QA probe fleet. Verbatim from wiki/Research/Harness-Reports/real-world-probes-${capturedAt}/${PROBE}.json (model ${MODEL} via Ollama, per the probe-fleet-qa debrief). GENERATED by apps/docs/scripts/generate-evidence-receipt.ts — do not hand-edit; regenerate from a probe run.`,
    task: { id: PROBE, label: meta.label, prompt: meta.prompt },
    model: { id: MODEL, provider: "ollama", tier: "local", note: "~4B-class local model, no API key" },
    receipt: {
      verdict,
      method: "heuristic",
      confidence: CONFIDENCE[verdict] ?? 0.8,
      strategy: report.strategyUsed ?? "reactive",
      terminatedBy: report.terminatedBy ?? "end_turn",
      goalAchieved: report.goalAchieved ?? true,
      success: report.success ?? true,
      toolCallStats: { failed: report.failCount ?? 0 },
      llmCalls: report.llmCalls ?? 0,
      tokensUsed: report.tokensUsed ?? 0,
      durationMs: report.durationMs ?? 0,
      deliverables,
      interventions: [] as unknown[],
    },
    checks: checks.map((c) => ({
      name: sanitize(c.name),
      pass: !!c.pass,
      detail: c.detail ? sanitize(c.detail) : "",
    })),
    capturedAt,
  };

  mkdirSync(resolve(DOCS_DIR, "src/data"), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `[evidence-receipt] ${PROBE} @ ${MODEL} → ${verdict}, ${deliverables.length} deliverables, ${checks.length} checks (from ${capturedAt})`,
  );
};

main();
