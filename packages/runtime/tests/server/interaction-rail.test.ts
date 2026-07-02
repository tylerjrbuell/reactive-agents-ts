// Run: bun test packages/runtime/tests/server/interaction-rail.test.ts --timeout 20000
//
// Durable interaction rail (Task 10) — e2e: an agent that pauses when the model
// calls `request_user_input`, persists the pause to the durable store, exposes
// it via listPendingInteractions, and resumes to completion when the human
// responds via respondToInteraction (the injected value visible to the model).
// Clones the durable-approval rail (approve-deny-resume.test.ts) shape.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgentBuilder } from "../../src/builder.js";

const durableDir = () => mkdtempSync(join(tmpdir(), "ra-interaction-"));

const buildAgent = (dir: string) =>
  new ReactiveAgentBuilder()
    .withName("interaction-e2e")
    .withProvider("test")
    .withTestScenario([
      {
        toolCall: {
          name: "request_user_input",
          args: { kind: "choice", prompt: "Which option?", schema: { options: ["red", "blue"] } },
        },
      },
      { match: "blue", text: "You picked blue. FINAL." },
      { text: "fallback" },
    ])
    // The request_user_input pause is intercepted in the reasoning kernel
    // (act.ts), so the reasoning path must be active — same as the approval e2e.
    .withReasoning()
    .withDurableRuns({ dir })
    .withUserInteraction()
    .build();

describe("interaction rail e2e", () => {
  test("pause → persist → respond → resume → complete", async () => {
    const dir = durableDir();
    const agent = await buildAgent(dir);

    await agent.run("help me choose");
    // Run paused: interaction pending
    const pending = await agent.listPendingInteractions();
    expect(pending.length).toBe(1);
    expect(pending[0]!.kind).toBe("choice");
    expect(pending[0]!.prompt).toBe("Which option?");

    const result = await agent.respondToInteraction(pending[0]!.runId, pending[0]!.interactionId, "blue");
    expect(result.success).toBe(true);
    expect(result.output).toContain("blue");

    const stillPending = await agent.listPendingInteractions();
    expect(stillPending.length).toBe(0);
    await agent.dispose();
  }, 20000);

  test("getDurableInfo exposes dbPath when durable configured", async () => {
    const dir = durableDir();
    const agent = await buildAgent(dir);
    const info = agent.getDurableInfo();
    expect(info?.dbPath).toContain(dir);
    await agent.dispose();
  }, 20000);

  // FIX 2 regression: a wrong `interactionId` must REJECT, not silently
  // succeed. Before the fix, `decideInteraction`'s 0-row UPDATE result was
  // ignored, the run resumed with a mismatched id, the runner's
  // `response.interactionId === pending.interactionId` guard skipped
  // injection, and the run returned the pause sentinel while
  // `respondToInteraction` reported `success: true` (silent data loss).
  test("respondToInteraction with a wrong interactionId rejects and the run stays pending", async () => {
    const dir = durableDir();
    const agent = await buildAgent(dir);

    await agent.run("help me choose");
    const pending = await agent.listPendingInteractions();
    expect(pending.length).toBe(1);
    const { runId, interactionId } = pending[0]!;

    let err: unknown;
    try {
      await agent.respondToInteraction(runId, `${interactionId}-wrong`, "blue");
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(String((err as { _tag?: string })?._tag ?? err)).toContain("InteractionStateError");

    // The run must still be pending — the mismatched id must not have decided it.
    const stillPending = await agent.listPendingInteractions();
    expect(stillPending.length).toBe(1);
    expect(stillPending[0]!.interactionId).toBe(interactionId);

    await agent.dispose();
  }, 20000);
});
