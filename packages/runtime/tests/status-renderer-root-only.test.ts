import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { makeStatusRenderer, makeObservableLogger } from "@reactive-agents/observability";

/**
 * The status renderer subscribes to AgentStarted/AgentCompleted on the SHARED
 * EventBus (one bus per run, threaded to every descendant). ExecutionEngine runs
 * for the root AND for every sub-agent, so constructing a renderer per invocation
 * is the same fan-out shape `669f6571` already fixed for the reasoning-stream
 * logger: N renderers each render all N siblings' lines, and each child renders a
 * spurious `spawn-agent → <itself>` line.
 *
 * Fix: construct the renderer only when `isRootExecution` (config.logPrefix unset).
 */
describe("status renderer is root-gated on the shared EventBus", () => {
  const engineSrc = readFileSync(
    join(import.meta.dir, "..", "src", "execution-engine.ts"),
    "utf8",
  );

  // Red-on-cut: revert the construction to bare `isStatusMode ? ... : null`.
  test("execution-engine constructs the renderer only for the root execution", () => {
    const call = engineSrc.indexOf("makeStatusRenderer(logger, process.stdout");
    expect(call).toBeGreaterThan(-1);
    // The ternary condition sits in the ~200 chars immediately preceding the
    // call. Strip comment lines so a doc-comment mentioning the gate can never
    // stand in for the gate itself.
    const condition = engineSrc
      .slice(Math.max(0, call - 200), call)
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(condition).toContain("isRootExecution");
  });

  // The named local exists and is derived from config.logPrefix (NOT swapped for
  // some other discriminator), and all three shared-resource gates use it.
  test("all three root-only gates share the single `isRootExecution` local", () => {
    expect(engineSrc).toContain("const isRootExecution = !lp;");
    const uses = engineSrc.split("isRootExecution").length - 1;
    // 1 declaration + 3 call sites (+ any comment mentions, hence >=).
    expect(uses).toBeGreaterThanOrEqual(4);
    // The bare boolean must no longer be re-derived at the gate sites.
    expect(engineSrc).not.toContain("if (!lp) {");
    expect(engineSrc).not.toContain("const unsubscribeReasoningSteps = lp");
  });

  // Behavioral proof of the defect this gate prevents: two renderers sharing one
  // bus each render the same sub-agent event.
  test("two renderers on one shared bus each render the same sub-agent line", async () => {
    const mkOut = () => {
      const s = new PassThrough() as unknown as NodeJS.WriteStream;
      s.isTTY = true;
      let written = "";
      s.on("data", (c: Buffer) => { written += c.toString(); });
      return { stream: s, read: () => written };
    };
    const rootOut = mkOut();
    const childOut = mkOut();

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        const logger = yield* makeObservableLogger({ live: false });
        const rootRenderer = makeStatusRenderer(logger, rootOut.stream, eb);
        const childRenderer = makeStatusRenderer(logger, childOut.stream, eb);
        yield* rootRenderer.start();
        yield* childRenderer.start();

        yield* eb.publish({
          _tag: "AgentStarted",
          taskId: "sub-1",
          agentId: "sub-researcher-1",
          provider: "test",
          model: "test-model",
          timestamp: Date.now(),
          parentAgentId: "root-agent",
          agentDisplayName: "researcher",
        } as never);

        rootRenderer.stop();
        childRenderer.stop();
      }).pipe(Effect.provide(EventBusLive)),
    );

    // Both rendered it — exactly the duplication root-gating removes.
    expect(rootOut.read()).toContain("spawn-agent → researcher");
    expect(childOut.read()).toContain("spawn-agent → researcher");
  });
});
