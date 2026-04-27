// analyze-multi-model.ts — Aggregate task-quality-gate JSON reports across
// models and surface common failure-mode patterns. Designed to inform
// generalizable harness improvements (vs per-model hardcoding).
//
// Run AFTER multiple PROBE_MODEL=X bun run task-quality-gate.ts invocations.
// Reads the latest report per model from harness-reports/, classifies each
// task's failure shape, and prints a cross-model failure-mode matrix.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORTS_DIR = resolve(import.meta.dir, "../../../../harness-reports");

type TaskResult = {
  taskId: string;
  output: string;
  toolCalls: { name: string; args?: unknown }[];
  quality: {
    composite: number;
    faithfulness: number;
    formatAdherence: number;
    completeness: number;
    noFabrication: number;
    callsRecall: boolean;
    notes?: string[];
  };
  tokensUsed?: number;
  stepsCount?: number;
};

type Report = {
  model: string;
  results: TaskResult[];
  summary: { avgComposite: number };
};

// ── Failure-mode classifier ─────────────────────────────────────────────────

type FailureMode =
  | "ok"                      // composite >= 0.85
  | "echo-preview"            // output contains framework compression marker
  | "raw-data-dump"           // output is raw JSON / data structure
  | "title-fabrication"       // faithfulness very low (<0.3) but output is well-structured
  | "format-drift"            // format=0 or low, content present
  | "incomplete-content"      // missing items / sections
  | "no-tool-called"          // tool wasn't called when needed
  | "refusal"                 // model refused / said it can't
  | "stuck-loop"              // task incomplete via dispatcher
  | "low-quality-mixed";      // multiple weak metrics

function classifyFailure(r: TaskResult): FailureMode {
  const out = r.output ?? "";
  const q = r.quality;

  if (q.composite >= 0.85) return "ok";

  if (out.includes("compressed preview") || out.includes("Type: Array") || out.includes("full text is stored")) {
    return "echo-preview";
  }
  if (/^\s*\[\s*\{/.test(out) && out.length > 1000) {
    return "raw-data-dump";
  }
  if (/Task incomplete|missing_required_tool|dispatcher-strategy-switch/.test(out)) {
    return "stuck-loop";
  }
  if (/I (?:can'?t|am not able to|cannot|won'?t)|I do not have access/.test(out.slice(0, 300))) {
    return "refusal";
  }
  if (q.faithfulness < 0.3 && out.length > 500 && q.formatAdherence > 0.5) {
    return "title-fabrication"; // wrote a plausible report but invented values
  }
  if (q.formatAdherence < 0.3 && q.faithfulness > 0.5) {
    return "format-drift"; // had real data but wrong structure
  }
  if (q.completeness < 0.5 && q.faithfulness > 0.5) {
    return "incomplete-content";
  }
  if ((r.toolCalls?.length ?? 0) === 0 && r.taskId !== "T1-knowledge-recall") {
    return "no-tool-called";
  }
  return "low-quality-mixed";
}

// ── Report loader ────────────────────────────────────────────────────────────

function loadLatestPerModel(): Map<string, Report> {
  const files = readdirSync(REPORTS_DIR)
    .filter((f) => f.startsWith("task-quality-gate-") && f.endsWith(".json"))
    .sort(); // lexicographic = chronological since timestamps are isoish
  const byModel = new Map<string, Report>();
  for (const f of files) {
    const path = resolve(REPORTS_DIR, f);
    const r = JSON.parse(readFileSync(path, "utf8")) as Report;
    byModel.set(r.model, r); // overwrite — we want the LATEST per model
  }
  return byModel;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const reports = loadLatestPerModel();
  if (reports.size === 0) {
    console.error(`No task-quality-gate reports found under ${REPORTS_DIR}`);
    process.exit(1);
  }

  const models = [...reports.keys()].sort();
  const taskIds = ["T1-knowledge-recall", "T2-single-tool-synthesis", "T3-selective-filter", "T4-multi-criteria", "T5-long-form-synthesis"];

  // ── 1. Per-model composite + per-task failure mode matrix ──────────────────
  console.log("\n══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("  Cross-model task-quality-gate — composite scores + failure-mode classification");
  console.log("══════════════════════════════════════════════════════════════════════════════════════════════════");
  const header = ["model".padEnd(30), "avg".padEnd(6), ...taskIds.map((t) => t.replace(/^T\d-/, "T").slice(0, 12).padEnd(13))];
  console.log(header.join(" | "));
  console.log("-".repeat(120));
  for (const model of models) {
    const r = reports.get(model)!;
    const cells = [model.padEnd(30), `${(r.summary.avgComposite * 100).toFixed(0)}%`.padEnd(6)];
    for (const tid of taskIds) {
      const tr = r.results.find((x) => x.taskId === tid);
      if (!tr) {
        cells.push("missing".padEnd(13));
        continue;
      }
      const score = `${(tr.quality.composite * 100).toFixed(0)}%`;
      const mode = classifyFailure(tr);
      const annot = mode === "ok" ? "✓" : mode.slice(0, 10);
      cells.push(`${score.padEnd(4)} ${annot}`.padEnd(13));
    }
    console.log(cells.join(" | "));
  }

  // ── 2. Failure-mode frequency across all (model, task) cells ──────────────
  console.log("\n══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("  Failure-mode frequency across all (model, task) runs");
  console.log("══════════════════════════════════════════════════════════════════════════════════════════════════");
  const modeFreq = new Map<FailureMode, { count: number; cells: string[] }>();
  for (const model of models) {
    const r = reports.get(model)!;
    for (const tr of r.results) {
      const mode = classifyFailure(tr);
      const existing = modeFreq.get(mode) ?? { count: 0, cells: [] };
      existing.count++;
      existing.cells.push(`${model}/${tr.taskId.replace(/^T\d-/, "T").slice(0, 8)}`);
      modeFreq.set(mode, existing);
    }
  }
  const sortedModes = [...modeFreq.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [mode, data] of sortedModes) {
    console.log(`  ${mode.padEnd(22)} | ${String(data.count).padEnd(3)} | ${data.cells.slice(0, 5).join(", ")}${data.cells.length > 5 ? `, +${data.cells.length - 5}` : ""}`);
  }

  // ── 3. Per-failure-mode example outputs (for diagnosis) ───────────────────
  console.log("\n══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("  Sample output per failure mode (first hit, first 200 chars)");
  console.log("══════════════════════════════════════════════════════════════════════════════════════════════════");
  for (const [mode] of sortedModes) {
    if (mode === "ok") continue;
    for (const model of models) {
      const r = reports.get(model)!;
      const tr = r.results.find((x) => classifyFailure(x) === mode);
      if (tr) {
        console.log(`\n[${mode}] ${model} / ${tr.taskId}`);
        console.log(`  ${(tr.output ?? "").slice(0, 200).replace(/\n/g, " | ")}`);
        if (tr.quality.notes && tr.quality.notes.length > 0) {
          console.log(`  notes: ${tr.quality.notes.join("; ")}`);
        }
        break;
      }
    }
  }

  // ── 4. Patterns by family ──────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("  Per-family aggregates");
  console.log("══════════════════════════════════════════════════════════════════════════════════════════════════");
  const familyOf = (m: string): string => {
    if (m.startsWith("gemma")) return "gemma";
    if (m.startsWith("qwen")) return "qwen";
    if (m.startsWith("llama")) return "llama";
    if (m.startsWith("cogito")) return "cogito";
    if (m.startsWith("granite")) return "granite";
    if (m.startsWith("gpt")) return "gpt-oss";
    if (m.startsWith("deepseek")) return "deepseek";
    return "other";
  };
  const familyAvg = new Map<string, { sum: number; count: number; modes: Map<FailureMode, number> }>();
  for (const model of models) {
    const r = reports.get(model)!;
    const fam = familyOf(model);
    const existing = familyAvg.get(fam) ?? { sum: 0, count: 0, modes: new Map() };
    for (const tr of r.results) {
      existing.sum += tr.quality.composite;
      existing.count++;
      const mode = classifyFailure(tr);
      existing.modes.set(mode, (existing.modes.get(mode) ?? 0) + 1);
    }
    familyAvg.set(fam, existing);
  }
  for (const [fam, data] of [...familyAvg.entries()].sort((a, b) => b[1].sum / b[1].count - a[1].sum / a[1].count)) {
    const avg = data.sum / data.count;
    const topModes = [...data.modes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`  ${fam.padEnd(10)} | avg ${(avg * 100).toFixed(0)}% | ${data.count} runs | top failure modes: ${topModes.map(([m, c]) => `${m}(${c})`).join(", ")}`);
  }
  console.log("");
}

main();
