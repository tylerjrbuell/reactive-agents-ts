// Spike S4 CLI: trigger census over saved traces. Zero tokens.
//   bun packages/benchmarks/src/spikes/s4-trigger-census.ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compareActivity } from "@reactive-agents/trace";
import { type SavedCell, loadResults } from "./cells.js";
import { COMPARISONS } from "./comparisons.js";
import { cellKeys, census, requiredEffectGivenTrigger } from "./s4-census.js";

const ROOT = join(import.meta.dir, "../../../../wiki/Research");
const out: string[] = [];
const say = (s = ""): number => out.push(s);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

const walk = (d: string, acc: string[]): string[] => {
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e.startsWith("traces")) continue;
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (e.endsWith(".json") && s.size > 500) acc.push(p);
  }
  return acc;
};

// Corpus: every saved cell whose trace resolves, deduplicated by trace file.
const seen = new Set<string>();
const keyed: { cell: SavedCell; keys: ReadonlySet<string> }[] = [];
let totalCells = 0;
let withPath = 0;
for (const f of walk(ROOT, [])) {
  const r = loadResults(f);
  if (!r) continue;
  for (const cell of r.cells) {
    totalCells++;
    if (!cell.traceFile) continue;
    withPath++;
    if (seen.has(cell.traceFile)) continue;
    seen.add(cell.traceFile);
    const keys = cellKeys(cell);
    if (keys && cell.accuracy !== null) keyed.push({ cell, keys });
  }
}
say("## S4 trigger census");
say();
say(`Saved cells scanned: ${totalCells}; with a traceFile path: ${withPath}; unique traces that resolve on disk and parse: ${keyed.length}.`);
say(`Tasks: ${new Set(keyed.map((k) => k.cell.taskId)).size}; tiers: ${new Set(keyed.map((k) => k.cell.tier)).size}.`);
say();

const rows = census(keyed);
say("### All mechanism keys (rate = cells where the key occurred / all resolvable cells)");
say();
say("| key | cells | rate | tasks fired | top task (rate) | < 5%? |");
say("| --- | --- | --- | --- | --- | --- |");
for (const r of rows) say(`| ${r.key} | ${r.cellsFired}/${r.cells} | ${pct(r.rate)} | ${r.tasksFired}/${r.tasks} | ${r.topTask} (${pct(r.topTaskRate)}) | ${r.rate < 0.05 ? "yes" : ""} |`);
const below = rows.filter((r) => r.rate < 0.05).length;
say();
say(`Keys: ${rows.length}; firing in < 5% of cells: ${below} (${pct(rows.length === 0 ? 0 : below / rows.length)}).`);

// Named mechanisms: key patterns.
const MECH: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "parallelToolHint (signal)", re: /parallel-tool-hint/ },
  { name: "leanFinalTurn (guard)", re: /lean_final_turn/ },
  { name: "exit gate", re: /exit_gate/ },
  { name: "dispatcher_early_stop ending", re: /^end:.*dispatcher_early_stop/ },
  { name: "loop detection", re: /loop|repeat|stall/ },
  { name: "strategy switching", re: /^strategy-switch:/ },
  { name: "forcing / act-or-answer", re: /forc|act[-_]or[-_]answer/ },
  { name: "abstention / honesty", re: /abst|decline|honest/ },
  { name: "budget / wrap-up", re: /budget|wrap/ },
  { name: "tool gate", re: /tool[-_]gate/ },
  { name: "input / write coverage requirement", re: /^requirement:(input|write)-coverage/ },
  { name: "loop guidance", re: /loop_guidance/ },
  { name: "verifier / delivery check", re: /verif|deliver/ },
];
say();
say("### Named mechanisms (union of matching keys; per-task top rate)");
say();
say("| mechanism | matching keys | cells fired | rate | top task (rate) | effect-given-trigger needed for +3pp whole-suite | < 5%? |");
say("| --- | --- | --- | --- | --- | --- | --- |");
for (const m of MECH) {
  const hit = keyed.filter(({ keys }) => [...keys].some((k) => m.re.test(k)));
  const byTask = new Map<string, { n: number; t: number }>();
  for (const { cell } of keyed) byTask.set(cell.taskId, { n: 0, t: (byTask.get(cell.taskId)?.t ?? 0) + 1 });
  for (const { cell } of hit) byTask.set(cell.taskId, { n: (byTask.get(cell.taskId)?.n ?? 0) + 1, t: byTask.get(cell.taskId)?.t ?? 1 });
  const top = [...byTask].map(([t, v]) => ({ t, r: v.n / v.t })).sort((a, b) => b.r - a.r)[0];
  const rate = keyed.length === 0 ? 0 : hit.length / keyed.length;
  const keysN = rows.filter((r) => m.re.test(r.key)).length;
  const need = requiredEffectGivenTrigger(3, rate);
  say(`| ${m.name} | ${keysN} | ${hit.length}/${keyed.length} | ${pct(rate)} | ${top ? `${top.t} (${pct(top.r)})` : "-"} | ${Number.isFinite(need) ? `${need.toFixed(0)}pp${need > 100 ? " (impossible)" : ""}` : "inf"} | ${rate < 0.05 ? "yes" : ""} |`);
}

// Per-comparison: which keys moved between baseline and candidate arms (the mechanism's own signature).
say();
say("### Opt-in mechanism signature per comparison (candidate arm vs baseline arm, trace-resolvable cells)");
say();
say("| comparison | base runs | cand runs | top changed keys (base -> cand runs) | candidate-arm cells with the top key | per-task firing of the top key in the candidate arm |");
say("| --- | --- | --- | --- | --- | --- |");
for (const spec of COMPARISONS) {
  const get = (files: readonly string[]): { cell: SavedCell; keys: ReadonlySet<string> }[] =>
    files.flatMap((f) => {
      const p = join(ROOT, f);
      const r = existsSync(p) ? loadResults(p) : undefined;
      return (r?.cells ?? []).flatMap((cell) => {
        const keys = cellKeys(cell);
        return keys ? [{ cell, keys }] : [];
      });
    });
  const b = get(spec.baseline);
  const c = get(spec.candidate);
  if (b.length === 0 || c.length === 0) {
    say(`| ${spec.id} | ${b.length} | ${c.length} | (no resolvable traces) | | |`);
    continue;
  }
  const cmp = compareActivity(b.map((x) => x.keys), c.map((x) => x.keys));
  const top = cmp.changed.slice(0, 3);
  const topKey = top[0]?.key;
  const perTask = new Map<string, { n: number; t: number }>();
  for (const { cell, keys } of c) {
    const e = perTask.get(cell.taskId) ?? { n: 0, t: 0 };
    perTask.set(cell.taskId, { n: e.n + (topKey !== undefined && keys.has(topKey) ? 1 : 0), t: e.t + 1 });
  }
  const tasksCol = [...perTask].map(([t, v]) => `${t} ${v.n}/${v.t}`).join(", ");
  say(`| ${spec.id} | ${b.length} | ${c.length} | ${top.map((t) => `${t.key} ${t.before}->${t.after}`).join("; ") || "none changed"} | ${top[0] ? `${top[0].after}/${c.length} (${pct(top[0].after / c.length)})` : "-"} | ${tasksCol} |`);
}
console.log(out.join("\n"));
