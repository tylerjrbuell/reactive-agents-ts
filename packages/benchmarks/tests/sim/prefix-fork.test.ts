// Run: bun run repo test packages/benchmarks/tests/sim/prefix-fork.test.ts
// S6 Q4: prefix-fork from a golden trace (feasibility probe). Zero tokens; the scratch
// file root is a repo-ignored directory (`.bench-run-*`), never /tmp.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { withFileRoot } from "@reactive-agents/tools";
import { loadRecordedRun } from "@reactive-agents/replay";
import { policyLLMLayer } from "../../src/sim/policy-model.js";
import { prefixForkLayer } from "../../src/sim/prefix-fork.js";

const ROOT = join(import.meta.dir, "..", "..", ".bench-run-sim-fork");

describe("prefix-fork", () => {
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

  it("replays call 0 from the recording, substitutes call 1 with a policy; live tools run", async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const run = await loadRecordedRun(join(import.meta.dir, "..", "..", "golden", "tool-write.jsonl"));
    const fork = prefixForkLayer(
      run.trace.events,
      1,
      policyLLMLayer(() => ({ text: "SUBSTITUTED: the note is written and done." }), 3).layer,
    );
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withModel("fork")
      .withTools({ builtins: ["file-write"] })
      .withRequiredTools({ tools: ["file-write"] })
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(4)
      .withReplayLLM(fork.layer)
      .build();
    const res = await withFileRoot(ROOT, () => agent.run(run.task));
    await agent.dispose();
    const c = fork.counts();
    expect(c.replayed).toBe(1);
    expect(c.substituted).toBeGreaterThan(0);
    expect(String(res.output)).toContain("SUBSTITUTED");
    expect(existsSync(join(ROOT, "note.md"))).toBe(true);
    expect(readdirSync(ROOT)).toContain("note.md");
  }, 30000);
});
