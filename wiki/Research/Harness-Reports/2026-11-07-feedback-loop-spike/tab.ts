import { readFileSync, readdirSync } from "node:fs";
const O = process.argv[2];
const seen = new Map<string, any>();
for (const f of readdirSync(O).filter((x) => x.endsWith(".json") && x.includes("__"))) {
  let j: any; try { j = JSON.parse(readFileSync(`${O}/${f}`, "utf8")); } catch { continue; }
  for (const r of j.runs ?? []) {
    const id = r.runId ?? r.attribution?.runId ?? r.path;
    if (seen.has(id)) continue;
    const lines = readFileSync(r.path, "utf8").split("\n").filter(Boolean);
    let task = "?", score = -1, failed: string[] = [], model = "?", grader = "";
    for (const l of lines) {
      if (l.includes('"eval-graded"')) { const e = JSON.parse(l); task = e.taskId; score = e.score; grader = e.grader; failed = (e.checks ?? []).filter((c: any) => !c.passed).map((c: any) => c.name); }
      if (l.includes('"run-started"')) { const e = JSON.parse(l); model = e.model ?? e.config?.model ?? "?"; }
    }
    seen.set(id, { id, cohort: f.replace(".json", ""), path: r.path, reason: r.reason ?? r.attribution?.reason, task, score, failed, model, grader });
  }
}
const all = [...seen.values()];
console.log("unique runs", all.length);
const tally: Record<string, number> = {};
for (const r of all) tally[r.reason] = (tally[r.reason] ?? 0) + 1;
console.log(tally);
const w = all.filter((r) => r.reason === "model:had-evidence-wrong-output");
const byTask: Record<string, number> = {};
for (const r of w) byTask[r.task] = (byTask[r.task] ?? 0) + 1;
console.log("HEWO by task", byTask);
Bun.write(`${O}/hewo.json`, JSON.stringify(w, null, 1));
Bun.write(`${O}/all.json`, JSON.stringify(all, null, 1));
