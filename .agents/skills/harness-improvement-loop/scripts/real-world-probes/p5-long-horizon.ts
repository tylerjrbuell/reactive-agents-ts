// P5 — long-horizon multi-step agent (.withLongHorizon). Exercises the A2
// pace bands + goal evaluation. Known suspect: goalAchieved stays null.
import { ReactiveAgents } from "reactive-agents";
import { runProbe, fileExistsCheck, check, QA_DIR } from "./probe-harness.ts";
import { join } from "node:path";
import { rmSync } from "node:fs";

const OUT = join(QA_DIR, "p5-notes.md");
rmSync(OUT, { force: true });

await runProbe({
  name: "p5-long-horizon",
  build: () =>
    ReactiveAgents.create()
      .withProvider("ollama")
      .withModel({ model: "gemma4", numCtx: 32768 })
      .withTools()
      .withLongHorizon()
      .build(),
  task:
    "Research the three largest moons of Jupiter with web searches (one search per moon is fine), then write a markdown file ./qa-out/p5-notes.md with one section per moon covering diameter and one notable fact.",
  grade: (result) => [
    fileExistsCheck("deliverable-on-disk", OUT),
    check(
      "goalAchieved-not-null-under-longHorizon",
      result.goalAchieved !== null && result.goalAchieved !== undefined,
      `goalAchieved=${result.goalAchieved}`,
    ),
    check("run-success", result.success === true, `success=${result.success}`),
  ],
});
