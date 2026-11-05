// Run: bun test packages/runtime/tests/seam-start-run.test.ts --timeout 20000
//
// Seam pin for engine/start-run.ts (Plan 9 item 1R stage 1): every run entry
// opens ONE run scope through `startRun`, which binds the caller's file root
// and the agent's document store; sub-agents nest with `childRunScope`
// (file root + document store inherited, tool stores fresh).
//
// RED-ON-CUT (verified by temporary mutation):
// - drop `startRun(...)` from `agent/run-task-effect.ts`: the concurrent cell
//   fails (the find tool reads the process default store, the file-write lands
//   in process.cwd()), and the sub-agent cell fails (no parent root to inherit).
// - drop the document-store binding inside `startRun`: the concurrent cell fails.
// - drop the file-root binding inside `startRun`: both E2E cells fail.
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { Effect, Fiber, Ref } from "effect";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { childContext, rootContext, type AgentEvent } from "@reactive-agents/core";
import { childRunScope } from "@reactive-agents/core/internal/run-scope";
import { createDocumentStore, currentDocumentStore, currentScratchpadStore, getFileRoot, withFileRoot } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/index.js";
import { agentDocumentStoreLayer, captureCallerFileRoot, startRun } from "../src/engine/start-run.js";

const roots: string[] = [];
const strays: string[] = [];
const mkRoot = (tag: string): string => {
  const r = mkdtempSync(join(tmpdir(), `ra-start-run-${tag}-`));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const p of strays.splice(0)) rmSync(p, { force: true });
});
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

type Step = { readonly type: string; readonly content?: string };
const observations = (r: { readonly metadata: unknown }): string =>
  ((r.metadata as { reasoningSteps?: readonly Step[] }).reasoningSteps ?? [])
    .filter((s) => s.type === "observation")
    .map((s) => s.content ?? "")
    .join("\n");

/** A fiber started OUTSIDE any file root, kept busy so it starts scheduler drains. */
const startPoisonFiber = () => Effect.runFork(Effect.forever(Effect.yieldNow()));

describe("startRun: one root entry per run", () => {
  it("two agents run concurrently with different file roots and document stores; each sees only its own", async () => {
    const file = `start-run-${randomUUID()}.txt`;
    strays.push(join(process.cwd(), file));
    const build = (marker: string, content: string) =>
      ReactiveAgents.create()
        .withName(`start-run-${content}`)
        .withProvider("test")
        .withModel("test")
        .withTestScenario([
          { toolCall: { name: "find", args: { query: "zebra telescope", scope: "documents" } } },
          { toolCall: { name: "file-write", args: { path: file, content } } },
          { text: "FINAL ANSWER: done." },
        ] as never)
        .withTools({ builtins: ["file-write"], adaptive: false })
        .withMetaTools({ find: true })
        .withDocuments([{ content: `${marker} zebra telescope`, source: `${content}.md` }])
        .withMaxIterations(5)
        .build();
    const a = await build("ALPHA-RUN-MARKER-3f1a", "A");
    const b = await build("BETA-RUN-MARKER-8c2e", "B");
    const rootA = mkRoot("a");
    const rootB = mkRoot("b");
    const poison = startPoisonFiber();
    try {
      const [ra, rb] = await Promise.all([
        withFileRoot(rootA, () => a.run("Find zebra telescope, then write the file.")),
        withFileRoot(rootB, () => b.run("Find zebra telescope, then write the file.")),
      ]);
      expect(observations(ra)).toContain("ALPHA-RUN-MARKER-3f1a");
      expect(observations(ra)).not.toContain("BETA-RUN-MARKER-8c2e");
      expect(observations(rb)).toContain("BETA-RUN-MARKER-8c2e");
      expect(observations(rb)).not.toContain("ALPHA-RUN-MARKER-3f1a");
    } finally {
      await Effect.runPromise(Fiber.interrupt(poison));
      await a.dispose();
      await b.dispose();
    }
    expect(readFileSync(join(rootA, file), "utf8")).toBe("A");
    expect(readFileSync(join(rootB, file), "utf8")).toBe("B");
    expect(existsSync(join(process.cwd(), file))).toBe(false);
  }, 20000);

  it("a dynamic sub-agent resolves relative paths against its parent's file root", async () => {
    const root = mkRoot("parent");
    const file = `start-run-child-${randomUUID()}.txt`;
    writeFileSync(join(root, file), "CHILD-SAW-PARENT-ROOT-6d0b");
    const agent = await ReactiveAgents.create()
      .withName("start-run-parent")
      .withProvider("test")
      .withModel("test")
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTools({ adaptive: false })
      .withTestScenario([
        // The child shares this scenario with its own cursor; only its prompt carries KIDTASK.
        { match: "KIDTASK", toolCall: { name: "file-read", args: { path: file } } },
        { match: "ROOTTASK", toolCall: { name: "spawn-agent", args: { task: "KIDTASK read the file", name: "kid", tools: ["file-read"] } } },
        { text: "FINAL ANSWER: done." },
      ] as never)
      .withMaxIterations(4)
      .build();
    const reads: { readonly success: boolean; readonly result?: unknown }[] = [];
    await agent.subscribe((e: AgentEvent) => {
      if (e._tag === "ToolCallCompleted" && e.toolName === "file-read") reads.push(e);
    });
    const poison = startPoisonFiber();
    try {
      await withFileRoot(root, () => agent.run("ROOTTASK: delegate the read."));
    } finally {
      await Effect.runPromise(Fiber.interrupt(poison));
      await agent.dispose();
    }
    expect(reads.length).toBeGreaterThan(0);
    expect(JSON.stringify(reads)).toContain("CHILD-SAW-PARENT-ROOT-6d0b");
    expect(reads.some((r) => r.success && JSON.stringify(r.result).includes("CHILD-SAW-PARENT-ROOT-6d0b"))).toBe(true);
  }, 20000);
});

describe("startRun: slot bindings (direct)", () => {
  const ctx = rootContext("start-run-direct", "agent-direct");

  it("binds the agent store from AgentDocumentStore; a spec store overrides it", async () => {
    const agentStore = createDocumentStore();
    const override = createDocumentStore();
    const fromLayer = await Effect.runPromise(
      startRun({ context: ctx })(currentDocumentStore).pipe(Effect.provide(agentDocumentStoreLayer(agentStore))),
    );
    expect(fromLayer).toBe(agentStore);
    const fromSpec = await Effect.runPromise(
      startRun({ context: ctx, documentStore: override })(currentDocumentStore).pipe(
        Effect.provide(agentDocumentStoreLayer(agentStore)),
      ),
    );
    expect(fromSpec).toBe(override);
  });

  it("a captured root wins over the ALS root at startRun; a captured 'none' is not re-captured", async () => {
    const early = mkRoot("early");
    const late = mkRoot("late");
    const captured = withFileRoot(early, () => captureCallerFileRoot());
    const none = captureCallerFileRoot();
    const seen = await withFileRoot(late, () =>
      Effect.runPromise(startRun({ context: ctx, fileRoot: captured })(Effect.sync(() => getFileRoot()))),
    );
    expect(seen).toBe(early);
    const seenNone = await withFileRoot(late, () => {
      const run = startRun({ context: ctx, fileRoot: none })(Effect.sync(() => getFileRoot()));
      return Effect.runPromise(run);
    });
    // `none` binds no root: resolution falls through to the ALS store / cwd, never `early`.
    expect(seenNone).not.toBe(early);
  });

  it("a second startRun inside a run dies; childRunScope nests with fresh tool stores and the parent's root", async () => {
    const root = mkRoot("nest");
    const nested = await Effect.runPromiseExit(
      startRun({ context: ctx, fileRoot: root })(startRun({ context: ctx, fileRoot: root })(Effect.void)),
    );
    expect(nested._tag).toBe("Failure");

    const child = await Effect.runPromise(
      startRun({ context: ctx, fileRoot: root })(
        Effect.gen(function* () {
          const parentPad = yield* currentScratchpadStore;
          yield* Ref.update(parentPad, (m) => new Map(m).set("pk", "parent"));
          return yield* childRunScope(childContext(ctx, "kid"))(
            Effect.gen(function* () {
              const pad = yield* currentScratchpadStore;
              return { same: pad === parentPad, keys: [...(yield* Ref.get(pad)).keys()], root: getFileRoot() };
            }),
          );
        }),
      ),
    );
    expect(child.same).toBe(false);
    expect(child.keys).toEqual([]);
    expect(child.root).toBe(root);
  });
});
