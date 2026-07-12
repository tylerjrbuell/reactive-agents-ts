// P7 — code-execution agent (code-action strategy). Deterministic compute
// with an exact answer: sum of squares 1..250 = 5,239,625.
import { ReactiveAgents } from "reactive-agents";
import { runProbe, check, QA_DIR } from "./probe-harness.ts";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";

const OUT = join(QA_DIR, "p7-answer.txt");
rmSync(OUT, { force: true });
const EXPECTED = "5239625";

await runProbe({
  name: "p7-code-action",
  build: () =>
    ReactiveAgents.create()
      .withProvider("ollama")
      .withModel({ model: "gemma4", numCtx: 32768 })
      .withTools()
      .withReasoning({ defaultStrategy: "code-action" })
      .build(),
  task:
    "Compute the exact sum of squares of the integers 1 through 250 (i.e. 1^2 + 2^2 + ... + 250^2) by executing code, then write ONLY the resulting integer to the file ./qa-out/p7-answer.txt.",
  grade: (result) => {
    const wrote = existsSync(OUT);
    const body = wrote ? readFileSync(OUT, "utf8") : "";
    const outputText = typeof result.output === "string" ? result.output : "";
    return [
      check(
        "exact-answer-on-disk-or-output",
        body.includes(EXPECTED) || outputText.includes(EXPECTED),
        wrote ? `file="${body.trim().slice(0, 60)}"` : `no file; output preview="${outputText.slice(0, 120)}"`,
      ),
      check("run-success", result.success === true, `success=${result.success}`),
      check(
        "strategy-was-code-action",
        result.metadata?.strategyUsed === "code-action",
        `strategyUsed=${result.metadata?.strategyUsed}`,
      ),
    ];
  },
});
