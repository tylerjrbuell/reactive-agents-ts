// Run: bun test packages/runtime/tests/file-root-run-entry.test.ts --timeout 20000
//
// Run-entry file-root binding (engine/run-file-root.ts).
//
// Incident: a benchmark agent's relative `parseDate.test.ts` write landed at
// the repo root although the harness wrapped `agent.run()` in
// `withFileRoot(tmpDir, ...)`. The root lived only in AsyncLocalStorage, and
// Effect's scheduler resumes fibers in the ALS context of whichever fiber
// started the drain. `@reactive-agents/tools` now carries the root in a
// FiberRef (`FileRootRef`), but only if something binds it: the runtime binds
// it where `run()`, `runStream()` (and `chat()` through it), `runEffect()`,
// `runDurable` and the agent facades hand work to the Effect runtime.
//
// RED-ON-CUT: make `bindCallerFileRoot` return its effect unchanged and the
// run() and runStream() cells write into process.cwd() instead of the root.
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { Effect, Fiber } from "effect";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withFileRoot } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/builder.js";

const root = mkdtempSync(join(tmpdir(), "ra-file-root-entry-"));
const strays: string[] = [];

afterEach(() => {
  // A failing run writes into process.cwd(); never leave it there.
  for (const p of strays.splice(0)) rmSync(p, { force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A fiber started OUTSIDE any file root, kept busy so it starts scheduler drains. */
const startPoisonFiber = () => Effect.runFork(Effect.forever(Effect.yieldNow()));

const buildAgent = (name: string) =>
  ReactiveAgents.create()
    .withName("file-root-entry")
    .withProvider("test")
    .withModel("test")
    .withTestScenario([
      { match: "Write", text: "Writing.", toolCall: { name: "file-write", args: { path: name, content: "export {}\n" } } },
      { text: "FINAL ANSWER: done." },
    ] as never)
    .withTools({ builtins: ["file-write"], adaptive: false })
    .withMaxIterations(4)
    .build();

describe("run entries bind the caller's file root onto the run fiber", () => {
  it("run(): a relative file-write under withFileRoot lands in the root with a foreign fiber running", async () => {
    const name = `entry-run-${randomUUID()}.test.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await buildAgent(name);
    const poison = startPoisonFiber();
    try {
      await withFileRoot(root, () => agent.run(`Write ${name}`));
    } finally {
      await Effect.runPromise(Fiber.interrupt(poison));
      await agent.dispose();
    }
    expect(existsSync(join(process.cwd(), name))).toBe(false);
    expect(existsSync(join(root, name))).toBe(true);
  }, 20000);

  it("runStream(): the same write lands in the root with a foreign fiber running", async () => {
    const name = `entry-stream-${randomUUID()}.test.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await buildAgent(name);
    const poison = startPoisonFiber();
    try {
      await withFileRoot(root, async () => {
        for await (const _ev of agent.runStream(`Write ${name}`)) {
          // drain
        }
      });
    } finally {
      await Effect.runPromise(Fiber.interrupt(poison));
      await agent.dispose();
    }
    expect(existsSync(join(process.cwd(), name))).toBe(false);
    expect(existsSync(join(root, name))).toBe(true);
  }, 20000);

  it("CONTROL: with no file root active, a run resolves against process.cwd() as before", async () => {
    const name = `entry-noroot-${randomUUID()}.test.ts`;
    strays.push(join(process.cwd(), name));
    const agent = await buildAgent(name);
    try {
      await agent.run(`Write ${name}`);
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(process.cwd(), name))).toBe(true);
  }, 20000);
});
