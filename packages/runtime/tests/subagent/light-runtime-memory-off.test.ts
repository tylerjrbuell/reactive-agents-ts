// Run: bun test packages/runtime/tests/subagent/light-runtime-memory-off.test.ts --timeout 30000
//
// A sub-agent's light runtime with memory off must not touch the user's memory
// directory. It used to open the default user-scope database for its own agent
// id (`sub-<name>-<Date.now()>`), so every sub-agent run, test runs included,
// left a `~/.reactive-agents/memory/sub-*` folder behind (25k+ folders found on
// the dev machine, 2026-11-11). Memory off now means an in-process database.
//
// RED-ON-CUT: drop `dbPath: ":memory:"` from the memory-off branch of
// createLightRuntime (runtime.ts) and the folder appears under the temp HOME.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { AgentId, generateTaskId } from "@reactive-agents/core";
import { createLightRuntime } from "../../src/runtime.js";
import { ExecutionEngine } from "../../src/execution-engine.js";

describe("light runtime memory-off writes no memory folder", () => {
  let home: string;
  let saved: { HOME?: string; USERPROFILE?: string };

  beforeEach(() => {
    saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    home = mkdtempSync(join(tmpdir(), "ra-light-home-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(() => {
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    if (saved.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = saved.USERPROFILE;
    rmSync(home, { recursive: true, force: true });
  });

  it("a sub-agent run leaves ~/.reactive-agents/memory untouched", async () => {
    const agentId = "sub-folderless-1234";
    const runtime = createLightRuntime({
      agentId,
      provider: "test",
      testScenario: [{ text: "FINAL ANSWER: done" }],
      enableReasoning: true,
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* Effect.either(
          engine.execute({
            id: generateTaskId(),
            agentId: Schema.decodeSync(AgentId)(agentId),
            type: "query",
            input: { question: "hi" },
            priority: "medium",
            status: "pending",
            metadata: { tags: [] },
            createdAt: new Date(),
          }),
        );
      }).pipe(Effect.provide(runtime)),
    );
    expect(existsSync(join(home, ".reactive-agents", "memory", agentId))).toBe(false);
    expect(existsSync(join(home, ".reactive-agents"))).toBe(false);
  }, 30_000);
});
