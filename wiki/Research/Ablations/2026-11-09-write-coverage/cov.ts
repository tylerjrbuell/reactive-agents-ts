import { readFileSync, readdirSync } from "node:fs";
const D = process.argv[2];
for (const f of readdirSync(D).filter((x) => /^(base|wc)-ab-.*\.json$/.test(x)).sort()) {
  const arm = f.split("-")[0], tier = f.replace(/^(base|wc)-ab-|\.json$/g, "");
  const by: Record<string, string[]> = {};
  for (const c of JSON.parse(readFileSync(`${D}/${f}`, "utf8")).cells as any[]) {
    if (c.status === "error") continue;
    const w = new Set<string>(); let wcReq = 0, deny = 0;
    for (const l of readFileSync(c.traceFile, "utf8").split("\n")) {
      if (!l) continue;
      if (l.includes('"tool-call-end"')) { const e = JSON.parse(l); if (e.toolName === "file-write" && e.ok) { const p = String(e.args?.path).replace(/^.*\.bench-run-[^/]+\//, ""); if (/^src\/[a-z]+\.ts$/.test(p)) w.add(p); } }
      if (l.includes("write-coverage")) wcReq++;
      if (l.includes('"exit_gate"') && l.includes('"block"')) deny++;
    }
    (by[c.taskId] ??= []).push(`${w.size}${wcReq ? "*" : ""}${deny ? "d" : ""}`);
  }
  console.log(arm, tier, JSON.stringify(by));
}
