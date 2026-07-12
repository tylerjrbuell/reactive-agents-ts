// P1 — research-writer agent (the scratch.ts archetype, kept as regression).
// Web research + single file deliverable through the default reactive path.
import { ReactiveAgents } from "reactive-agents";
import { runProbe, fileExistsCheck, check, QA_DIR } from "./probe-harness.ts";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";

const OUT = join(QA_DIR, "p1-show.md");
rmSync(OUT, { force: true });

await runProbe({
  name: "p1-research-writer",
  build: () =>
    ReactiveAgents.create()
      .withProvider("ollama")
      .withModel({ model: "gemma4", numCtx: 32768 })
      .withTools()
      .build(),
  task:
    'Research the TV show "I Shouldn\'t Be Alive" season 1 with web searches, then save a bullet-point summary of the season to the local file ./qa-out/p1-show.md.',
  grade: (result) => [
    fileExistsCheck("deliverable-on-disk", OUT),
    check(
      "deliverable-nonempty",
      existsSync(OUT) && readFileSync(OUT, "utf8").trim().length > 100,
      existsSync(OUT) ? `${readFileSync(OUT, "utf8").length} chars` : "missing",
    ),
    check("run-success", result.success === true, `success=${result.success}`),
  ],
});
