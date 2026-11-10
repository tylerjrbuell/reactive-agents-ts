import { readFileSync } from "node:fs";
import { LH_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/long-horizon-tasks.ts";
const fx = new Map<string, Map<string, string>>(); for (const t of LH_TASKS as any[]) fx.set(t.id, new Map((t.fixtures ?? []).map((f: any) => [f.path, f.content])));
const norm = (s: string) => s.replace(/\s+/g, "").replace(/'/g, '"').replace(/;/g, "");
for (const f of process.argv.slice(3)) {
  let w = 0, noop = 0, brokenExports = 0, runs = 0;
  for (const c of JSON.parse(readFileSync(`${process.argv[2]}/${f}`, "utf8")).cells as any[]) {
    if (c.status === "error") continue; runs++;
    const orig = fx.get(c.taskId)!;
    for (const l of readFileSync(c.traceFile, "utf8").split("\n")) {
      if (!l.includes('"tool-call-end"')) continue; const e = JSON.parse(l);
      if (e.toolName !== "file-write" || !e.ok) continue;
      const p = String(e.args?.path).replace(/^.*\.bench-run-[^/]+\//, ""); const o = orig.get(p); if (!o || !/^src\//.test(p)) continue;
      w++; if (norm(o) === norm(String(e.args.content))) noop++;
      const ex = (s: string) => [...s.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]).sort().join();
      if (ex(o) !== ex(String(e.args.content))) brokenExports++;
    }
  }
  console.log(`${f}: runs=${runs} src-writes=${w} no-op(=original modulo whitespace/quotes)=${noop} changed-export-names=${brokenExports}`);
}
