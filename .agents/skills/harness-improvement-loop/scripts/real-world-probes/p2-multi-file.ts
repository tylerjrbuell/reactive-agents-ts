// P2 — multi-deliverable agent: TWO files, one markdown + one machine-readable
// JSON. Exercises multi-deliverable contract derivation + per-file receipt
// truth. Hermetic (facts given inline, no web).
import { ReactiveAgents } from "reactive-agents";
import { runProbe, fileExistsCheck, check, QA_DIR } from "./probe-harness.ts";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";

const REPORT = join(QA_DIR, "p2-report.md");
const DATA = join(QA_DIR, "p2-data.json");
rmSync(REPORT, { force: true });
rmSync(DATA, { force: true });

function jsonCheck() {
  if (!existsSync(DATA)) return check("data-json-valid", false, "missing file");
  try {
    const parsed = JSON.parse(readFileSync(DATA, "utf8"));
    return check(
      "data-json-valid",
      Array.isArray(parsed) && parsed.length === 3,
      `array=${Array.isArray(parsed)} len=${Array.isArray(parsed) ? parsed.length : "n/a"}`,
    );
  } catch (e) {
    return check("data-json-valid", false, `parse error: ${String(e).slice(0, 120)}`);
  }
}

await runProbe({
  name: "p2-multi-file",
  build: () =>
    ReactiveAgents.create()
      .withProvider("ollama")
      .withModel({ model: "gemma4", numCtx: 32768 })
      .withTools()
      .build(),
  task: `Using ONLY these facts — Jupiter has 95 confirmed moons, Saturn has 146, Mars has 2 — produce two files:
1. Write a short markdown comparison to the file ./qa-out/p2-report.md
2. Write a JSON array of exactly 3 objects like {"planet": "...", "moons": <number>} to the file ./qa-out/p2-data.json (raw JSON only, no markdown fences)`,
  grade: (result) => [
    fileExistsCheck("report-on-disk", REPORT),
    fileExistsCheck("data-on-disk", DATA),
    jsonCheck(),
    check(
      "both-deliverables-declared",
      (result.receipt?.deliverables?.length ?? 0) >= 2,
      `deliverables=${JSON.stringify(result.receipt?.deliverables)}`,
    ),
  ],
});
