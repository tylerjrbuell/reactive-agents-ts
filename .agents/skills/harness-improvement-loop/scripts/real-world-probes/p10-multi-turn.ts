// P10 — agent reuse: two sequential .run() calls on ONE built agent (the
// obvious user pattern for a session). Checks isolation + reuse safety.
import { ReactiveAgents } from "reactive-agents";
import { check, saveReport, coherenceChecks, QA_DIR, type CheckResult } from "./probe-harness.ts";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const OUT1 = join(QA_DIR, "p10-first.txt");
const OUT2 = join(QA_DIR, "p10-second.txt");
rmSync(OUT1, { force: true });
rmSync(OUT2, { force: true });
const started = Date.now();
let checks: CheckResult[] = [];
let crashed: string | undefined;
let taskId1: string | undefined;
let taskId2: string | undefined;

try {
  const agent = await ReactiveAgents.create()
    .withProvider("ollama")
    .withModel({ model: "gemma4", numCtx: 32768 })
    .withTools({ builtins: ["file-write"] })
    .build();
  try {
    const r1 = await agent.run("Write the single word 'alpha' to the file ./qa-out/p10-first.txt.");
    const r2 = await agent.run("Write the single word 'omega' to the file ./qa-out/p10-second.txt.");
    taskId1 = r1.taskId;
    taskId2 = r2.taskId;
    checks = [
      check("first-run-success", r1.success === true, `success=${r1.success}`),
      check("second-run-success", r2.success === true, `success=${r2.success}`),
      check("first-file", existsSync(OUT1)),
      check("second-file", existsSync(OUT2)),
      check("distinct-taskIds", !!taskId1 && !!taskId2 && taskId1 !== taskId2, `${taskId1} vs ${taskId2}`),
      ...coherenceChecks(r2).map((c) => ({ ...c, name: `second-${c.name}` })),
    ];
  } finally {
    await agent.dispose();
  }
} catch (e) {
  crashed = e instanceof Error ? e.message : String(e);
  checks.push(check("no-crash", false, crashed.slice(0, 200)));
}

saveReport({
  probe: "p10-multi-turn",
  taskId: taskId2,
  durationMs: Date.now() - started,
  ...(crashed ? { crashed } : {}),
  checks,
  failCount: checks.filter((c) => !c.pass).length,
});
