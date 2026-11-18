// Read-only per-turn slack classifier over trace JSONL files.
// Usage: bun classify.ts <file.jsonl>...   (prints per-run rows + totals as JSON)
import { readFileSync } from "node:fs";

type Ev = Record<string, unknown> & { kind: string; seq?: number };
type Call = { name: string; arguments?: unknown };
type Resp = { toolCalls?: Call[]; tokensIn?: number; tokensOut?: number; durationMs?: number; stopReason?: string };

const WRITE = new Set(["file-write", "file-edit"]);
const totals: Record<string, number> = {};
const tokTotals: Record<string, number> = {};
const msTotals: Record<string, number> = {};
const add = (k: string, tok: number, ms: number) => {
  totals[k] = (totals[k] ?? 0) + 1;
  tokTotals[k] = (tokTotals[k] ?? 0) + tok;
  msTotals[k] = (msTotals[k] ?? 0) + ms;
};
const rows: unknown[] = [];

for (const f of process.argv.slice(2)) {
  let evs: Ev[];
  try {
    evs = readFileSync(f, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ev);
  } catch {
    continue;
  }
  if (!evs.some((e) => e.kind === "run-completed")) continue; // unfinished: skip
  const ex = evs.filter((e) => e.kind === "llm-exchange");
  const thinks = ex.filter((e) => e.purpose === "think");
  const seen = new Set<string>();
  const labels: string[] = [];
  let lastToolNames: string[] = [];
  thinks.forEach((e, i) => {
    const r = (e.response ?? {}) as Resp;
    const calls = r.toolCalls ?? [];
    const tok = (r.tokensIn ?? 0) + (r.tokensOut ?? 0);
    const ms = r.durationMs ?? 0;
    const isLast = i === thinks.length - 1;
    let label: string;
    if (calls.length === 0) label = isLast ? "final-answer" : "think-only";
    else {
      const sigs = calls.map((c) => `${c.name}:${JSON.stringify(c.arguments ?? {})}`);
      const fresh = sigs.filter((s) => !seen.has(s));
      sigs.forEach((s) => seen.add(s));
      const names = calls.map((c) => c.name);
      if (fresh.length === 0) label = "repeat-identical";
      else if (
        names.every((n) => WRITE.has(n)) &&
        lastToolNames.length > 0 &&
        lastToolNames.every((n) => WRITE.has(n))
      ) label = "serial-write (batchable)";
      else if (
        names.every((n) => n === "web-search") &&
        lastToolNames.length > 0 &&
        lastToolNames.every((n) => n === "web-search")
      ) label = "serial-search (maybe batchable)";
      else label = "productive-tool";
      lastToolNames = names;
    }
    labels.push(label);
    add(label, tok, ms);
  });
  for (const e of ex.filter((x) => x.purpose !== "think")) {
    const r = (e.response ?? {}) as Resp;
    add(`non-think:${String(e.purpose ?? e.requestKind ?? "?")}`, (r.tokensIn ?? 0) + (r.tokensOut ?? 0), r.durationMs ?? 0);
  }
  const done = evs.find((e) => e.kind === "run-completed") as Ev;
  rows.push({ file: f.split("/").slice(-4).join("/"), turns: thinks.length, labels: labels.join(" > "), status: done.status, by: done.terminatedBy });
}
console.log(JSON.stringify({ rows, totals, tokTotals, msTotals }, null, 1));
