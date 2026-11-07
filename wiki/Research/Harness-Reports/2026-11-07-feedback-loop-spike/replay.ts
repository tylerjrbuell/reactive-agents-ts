// Zero-token: rebuild each run's final workspace (fixtures + recorded successful writes),
// then run (a) the agent-visible tests (task tests + agent-written tests) and (b) the hidden grader.
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { LH_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/long-horizon-tasks.ts";
const O = process.argv[2];
const all = JSON.parse(readFileSync(`${O}/all.json`, "utf8"));
const ids = ["rw-7", "lh-debug-green"];
const tasks = new Map(LH_TASKS.filter((t) => ids.includes(t.id)).map((t) => [t.id, t]));
const rel = (p: string) => p.replace(/^.*\.bench-run-[^/]+\//, "").replace(/^\.\//, "");
const out: unknown[] = [];
for (const r of all.filter((x: any) => ids.includes(x.task))) {
  const t: any = tasks.get(r.task);
  const ws = `${O}/ws/${r.id}`;
  rmSync(ws, { recursive: true, force: true });
  for (const f of t.fixtures) { mkdirSync(dirname(join(ws, f.path)), { recursive: true }); writeFileSync(join(ws, f.path), f.content); }
  const writes: string[] = []; let codeExec = 0;
  for (const l of readFileSync(r.path, "utf8").split("\n")) {
    if (!l.includes('"tool-call-end"')) continue;
    const e = JSON.parse(l);
    if (e.toolName === "code-execute") codeExec++;
    if (e.toolName !== "file-write" || !e.ok || typeof e.args?.content !== "string") continue;
    const p = rel(String(e.args.path));
    if (p.startsWith("/") || p.includes("..")) continue;
    mkdirSync(dirname(join(ws, p)), { recursive: true }); writeFileSync(join(ws, p), e.args.content); writes.push(p);
  }
  const agentTests = writes.filter((p) => /\.test\.ts$|\.spec\.ts$/.test(p));
  const testFiles = [...new Set([...(t.id === "lh-debug-green" ? t.fixtures.map((f: any) => f.path).filter((p: string) => p.startsWith("tests/")) : []), ...agentTests])];
  let visible: string = "none";
  if (testFiles.length) {
    const v = spawnSync("bun", ["test", ...testFiles.map((p) => `./${p}`)], { cwd: ws, encoding: "utf8", timeout: 30000 });
    const txt = (v.stdout ?? "") + (v.stderr ?? "");
    const pass = /(\d+) pass/.exec(txt)?.[1], fail = /(\d+) fail/.exec(txt)?.[1];
    visible = v.status === 0 ? `green(${pass})` : `red(${pass ?? 0}p/${fail ?? "?"}f)`;
  }
  for (const f of t.hiddenFixtures) writeFileSync(join(ws, f.path), f.content);
  const [cmd, ...args] = t.successCriteria.command.split(" ");
  const h = spawnSync(cmd, args, { cwd: ws, encoding: "utf8", timeout: 30000 });
  const ht = (h.stdout ?? "") + (h.stderr ?? "");
  const srcWritten = [...new Set(writes.filter((p) => p.startsWith("src/")))];
  out.push({ id: r.id, task: r.task, model: r.model, cohort: r.cohort, reason: r.reason, score: Math.round(r.score * 100) / 100, hiddenExit: h.status, visible, agentTests: agentTests.length, srcWritten, codeExec, failed: r.failed });
}
writeFileSync(`${O}/replay.json`, JSON.stringify(out, null, 1));
console.log(out.length, "runs replayed");
