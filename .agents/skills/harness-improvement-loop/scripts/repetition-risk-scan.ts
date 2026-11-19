// Zero-token trace scan (harness-warden, 2026-11-19): repetition-guard risk check
// for d38edf88a (repetitionGuard blocks on information yield; backstop 0.75 x maxIterations).
//
// Run: bun .agents/skills/harness-improvement-loop/scripts/repetition-risk-scan.ts <dir> [<dir> ...]
//
// For every trace (*.jsonl, recursive) and every non-meta tool that ran more than
// 4 times in one run, prints: call count, distinct canonical args, distinct
// results, failed calls, and how many of the calls repeated an earlier result
// (no new information). Also counts repetitionGuard nudges ("You have already
// called") seen in observations, and Gemini UNEXPECTED_TOOL_CALL hits.
//
// Reading the output: distinctResults close to calls = each call yielded new
// information. Many repeats or failures = a runaway the old count-based guard
// (block past 4 for parallel-safe tools, 2 otherwise, unless a new target) would
// have stopped.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const META = new Set(["todo", "recall", "final-answer", "task-complete", "context-status", "brief", "pulse", "find", "checkpoint", "staticBriefInfo", "userInteraction"]);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".jsonl") ? [p] : [];
  });

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

interface Ev { readonly kind?: string; readonly toolName?: string; readonly args?: unknown; readonly result?: unknown; readonly ok?: boolean; readonly runId?: string }

let runs = 0;
let nudges = 0;
let unexpected = 0;
const flagged: string[] = [];
for (const root of process.argv.slice(2)) {
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    runs++;
    nudges += (text.match(/You have already called /g) ?? []).length;
    unexpected += (text.match(/UNEXPECTED_TOOL_CALL/g) ?? []).length;
    const byTool = new Map<string, Array<{ args: string; result: string; ok: boolean }>>();
    let runId = "";
    for (const line of text.split("\n")) {
      if (!line.includes('"kind":"tool-call-end"')) continue;
      let ev: Ev;
      try { ev = JSON.parse(line) as Ev; } catch { continue; }
      runId = ev.runId ?? runId;
      const name = ev.toolName ?? "?";
      if (META.has(name)) continue;
      const list = byTool.get(name) ?? [];
      list.push({ args: canon(ev.args ?? {}), result: typeof ev.result === "string" ? ev.result : canon(ev.result), ok: ev.ok !== false });
      byTool.set(name, list);
    }
    for (const [tool, calls] of byTool) {
      if (calls.length <= 4) continue;
      const seen = new Set<string>();
      let repeats = 0;
      for (const c of calls) {
        if (seen.has(c.result)) repeats++;
        seen.add(c.result);
      }
      const distinctArgs = new Set(calls.map((c) => c.args)).size;
      const failed = calls.filter((c) => !c.ok).length;
      flagged.push(`${file.replace(/^.*h3-traces-ssw\//, "")}\t${runId}\t${tool}\tcalls=${calls.length}\tdistinctArgs=${distinctArgs}\tdistinctResults=${seen.size}\trepeatResults=${repeats}\tfailed=${failed}`);
    }
  }
}
console.log(`runs=${runs} repetitionNudges=${nudges} UNEXPECTED_TOOL_CALL=${unexpected} runs-with-tool>4=${flagged.length}`);
for (const f of flagged) console.log(f);
