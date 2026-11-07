import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const O = process.argv[2];
const rows = JSON.parse(readFileSync(`${O}/replay.json`, "utf8"));
const mods = ["clamp", "slugify", "chunk", "median", "duration", "dedupe"];
const bugs: Record<string, string> = { validator: "validator bug", processor: "processor bug", pipeline: "pipeline bug" };
const tally: Record<string, number> = {};
const inc = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
for (const r of rows) {
  const ws = `${O}/ws/${r.id}`;
  r.per = {};
  if (r.task === "lh-debug-green") {
    for (const m of mods) {
      const written = r.srcWritten.includes(`src/${m}.ts`);
      const v = spawnSync("bun", ["test", `./tests/${m}.test.ts`], { cwd: ws, encoding: "utf8", timeout: 20000 });
      const st = v.status === 0 ? "fixed" : written ? "written-wrong" : "not-written";
      r.per[m] = st; if (r.hiddenExit !== 0) inc(`lh ${st}`);
    }
  } else {
    for (const [f, label] of Object.entries(bugs)) {
      const written = r.srcWritten.includes(`src/${f}.ts`);
      const failedCheck = r.failed.some((n: string) => n.startsWith(label)) || r.failed.some((n: string) => n.startsWith("bun test"));
      const st = !failedCheck ? "fixed" : written ? "written-wrong" : "not-written";
      r.per[f] = st; if (r.hiddenExit !== 0) inc(`rw7 ${f} ${st}`);
    }
  }
}
writeFileSync(`${O}/replay2.json`, JSON.stringify(rows, null, 1));
console.log(Object.entries(tally).sort().map(([k, v]) => `${v}\t${k}`).join("\n"));
