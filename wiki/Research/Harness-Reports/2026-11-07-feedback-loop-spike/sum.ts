import { readFileSync, readdirSync } from "node:fs";
const D = process.argv[2];
const rows: any[] = [];
for (const f of readdirSync(D).filter((x) => /^(base|shell)-ab-.*\.json$/.test(x))) {
  const arm = f.split("-")[0];
  for (const c of Object.values(JSON.parse(readFileSync(`${D}/${f}`, "utf8")).cells) as any[]) {
    let sh = 0, shTest = 0, shOk = 0, srcW = new Set<string>(), cmds: string[] = [], lastShell = -1, lastWrite = -1;
    for (const l of readFileSync(c.traceFile, "utf8").split("\n")) {
      if (!l.includes('"tool-call-end"')) continue;
      const e = JSON.parse(l);
      if (e.toolName === "shell-execute") { sh++; if (e.ok) shOk++; const cmd = String(e.args?.command ?? ""); cmds.push(cmd.slice(0, 50)); if (/bun\s+test/.test(cmd)) shTest++; lastShell = e.seq; }
      if (e.toolName === "file-write" && e.ok) { const p = String(e.args?.path).replace(/^.*\.bench-run-[^/]+\//, ""); if (p.startsWith("src/") && !p.includes(".test.")) srcW.add(p); lastWrite = e.seq; }
    }
    rows.push({ arm, tier: c.tier, task: c.taskId, run: c.run, acc: c.accuracy, status: c.status, cause: c.causeLabel, tok: c.billedTokens, s: Math.round(c.durationMs / 1000), sh, shTest, shOk, srcW: srcW.size, cmds });
  }
}
const key = (r: any) => `${r.tier} ${r.task} ${r.arm}`;
const g = new Map<string, any[]>();
for (const r of rows) g.set(key(r), [...(g.get(key(r)) ?? []), r]);
console.log("tier task arm | acc(runs) | mean | runs w/ shell | w/ bun test | src targets written | tok | s | status");
for (const [k, rs] of [...g].sort()) {
  const m = rs.reduce((a, r) => a + r.acc, 0) / rs.length;
  console.log(`${k} | ${rs.map((r) => r.acc.toFixed(2)).join(",")} | ${m.toFixed(2)} | ${rs.filter((r) => r.sh).length}/${rs.length} | ${rs.filter((r) => r.shTest).length} | ${rs.map((r) => r.srcW).join(",")} | ${Math.round(rs.reduce((a, r) => a + r.tok, 0) / rs.length)} | ${Math.round(rs.reduce((a, r) => a + r.s, 0) / rs.length)} | ${[...new Set(rs.map((r) => r.status))].join("/")}`);
}
console.log("\nshell commands:"); for (const r of rows.filter((r) => r.sh)) console.log(`${r.tier} ${r.task} r${r.run} acc=${r.acc.toFixed(2)} ok=${r.shOk}/${r.sh} :: ${r.cmds.join(" ; ")}`);
Bun.write(`${D}/rows.json`, JSON.stringify(rows, null, 1));
