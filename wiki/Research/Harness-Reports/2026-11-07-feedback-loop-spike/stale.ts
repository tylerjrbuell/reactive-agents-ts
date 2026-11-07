// Zero-token: find duplicateGuard hits (durationMs 0 + "[Already done — do NOT repeat") and whether a
// successful mutation (file-write / shell / code-execute) landed between the original call and the replay.
import { readFileSync } from "node:fs";
const paths: string[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const MUT = new Set(["file-write", "shell-execute", "code-execute"]);
let runs = 0, runsHit = 0, hits = 0, stale = 0, staleRuns = 0; const byTool: Record<string, number> = {}; const ex: string[] = [];
for (const p of paths) {
  runs++;
  const ends = readFileSync(p, "utf8").split("\n").filter((l) => l.includes('"tool-call-end"')).map((l) => JSON.parse(l));
  let rh = false, rs = false;
  ends.forEach((e, i) => {
    const r = typeof e.result === "string" ? e.result : JSON.stringify(e.result ?? "");
    if (!r.includes("[Already done — do NOT repeat")) return;
    hits++; rh = true;
    const key = JSON.stringify({ t: e.toolName, a: e.args });
    const j = ends.findIndex((x, k) => k < i && x.ok && JSON.stringify({ t: x.toolName, a: x.args }) === key && !String(x.result ?? "").includes("[Already done"));
    if (j < 0) return;
    const mutated = ends.slice(j + 1, i).filter((x) => x.ok && MUT.has(x.toolName) && !(x.toolName === e.toolName && JSON.stringify(x.args) === JSON.stringify(e.args)));
    // a re-read is stale only if the mutation could touch it: same path for file-read, any mutation for shell/code
    const samePath = (x: any) => x.args?.path === e.args?.path;
    const touches = e.toolName === "file-read" ? mutated.some((x) => x.toolName !== "file-write" || samePath(x)) : e.toolName === "file-write" ? mutated.some((x) => x.toolName !== "file-write" || samePath(x)) : mutated.length > 0;
    if (touches) { stale++; rs = true; byTool[e.toolName] = (byTool[e.toolName] ?? 0) + 1; if (ex.length < 6) ex.push(`${p.split("/").slice(-4).join("/")} seq${e.seq} ${e.toolName} ${JSON.stringify(e.args).slice(0, 80)}`); }
  });
  if (rh) runsHit++; if (rs) { staleRuns++; console.error("STALE " + p); }
}
console.log({ runs, runsWithDupHit: runsHit, dupHits: hits, staleAfterMutation: stale, staleRuns, byTool }); console.log(ex.join("\n"));
