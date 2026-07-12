// P9 — strategy accounting matrix: the SAME hermetic file task through
// reflexion, plan-execute-reflect, and tree-of-thought. Every strategy must
// produce the deliverable AND report coherent accounting (the blueprint lies
// fixed 2026-07-11 — this probes the siblings).
import { ReactiveAgents } from "reactive-agents";
import { runProbe, check, QA_DIR } from "./probe-harness.ts";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

mkdirSync(join(QA_DIR, "p9"), { recursive: true });
writeFileSync(join(QA_DIR, "p9", "input.json"), JSON.stringify({ values: [17, 25, 58] }));

const STRATEGIES = ["reflexion", "plan-execute-reflect", "tree-of-thought"] as const;

for (const strategy of STRATEGIES) {
  const out = join(QA_DIR, "p9", `${strategy}.txt`);
  rmSync(out, { force: true });
  await runProbe({
    name: `p9-${strategy}`,
    build: () =>
      ReactiveAgents.create()
        .withProvider("ollama")
        .withModel({ model: "gemma4", numCtx: 32768 })
        .withTools({ builtins: ["file-read", "file-write"] })
        .withReasoning({ defaultStrategy: strategy })
        .build(),
    task: `Read ./qa-out/p9/input.json, add up the numbers in the "values" array, and write ONLY the resulting integer to the file ./qa-out/p9/${strategy}.txt.`,
    grade: (result) => {
      const wrote = existsSync(out);
      const body = wrote ? readFileSync(out, "utf8") : "";
      return [
        check("correct-sum-on-disk", wrote && body.includes("100"), wrote ? `file="${body.trim().slice(0, 40)}"` : "no file"),
        check(
          "strategy-honored",
          result.metadata?.strategyUsed === strategy,
          `requested=${strategy} used=${result.metadata?.strategyUsed}`,
        ),
      ];
    },
  });
}
