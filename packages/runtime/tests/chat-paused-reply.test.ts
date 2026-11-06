// Run: bun test packages/runtime/tests/chat-paused-reply.test.ts --timeout 20000
//
// A durable run that pauses at an approval gate on the NON-stream chat tool
// path (session.chat({ useTools: true })) must say so on the ChatReply, the
// same way a paused StreamCompleted does: `status` + `pendingApproval`. Hosts
// (Cortex chat, goal supervisor, schedules) otherwise persist the paused
// output as a final answer. The engine completion log must also not print
// "Task failed" for that pause.
//
// RED-ON-CUT:
//  - drop the `status` / `pendingApproval` spreads in chat/tool-reply.ts
//    -> cell 1 red.
//  - make engine/finalize/run-finalize.ts `completionVerb` ignore
//    `awaitingApprovalFor` -> cells 1 (log) and 4 red.
//  - drop the `paused` spread on the completion emit in run-finalize.ts
//    -> cell 2 red.
import { describe, it, expect, afterAll, spyOn } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";
import { makeObservableLogger, ObservableLogger } from "@reactive-agents/observability";
import { completionVerb, finalizeRun, isPausedResult } from "../src/engine/finalize/run-finalize.js";

const dir = mkdtempSync(join(tmpdir(), "ra-chat-paused-reply-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const riskyTool = {
  definition: {
    name: "risky-tool",
    description: "Mutates state — requires approval.",
    parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
    riskLevel: "high" as const,
    requiresApproval: true,
    timeoutMs: 5_000,
    source: "function" as const,
  },
  handler: () => Effect.succeed("ran"),
};

describe("ChatReply on a durable pause (tool path)", () => {
  it("carries status awaiting-approval + pendingApproval, and the completion log says paused", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-paused-reply")
      .withProvider("test")
      .withTestScenario([{ toolCall: { name: "risky-tool", args: { input: "go" } } }] as never)
      .withTools({ tools: [riskyTool] })
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withMaxIterations(4)
      .withDurableRuns({ dir, checkpointEvery: 1 })
      .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
      .build();

    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      const reply = await agent.session().chat("Use the risky tool with input go", { useTools: true });
      expect(reply.status).toBe("awaiting-approval");
      expect(reply.pendingApproval?.toolName).toBe("risky-tool");
      expect(typeof reply.pendingApproval?.runId).toBe("string");
      expect(reply.pendingInteraction).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    const completion = lines.filter((l) => l.includes("[completion]"));
    expect(completion.some((l) => l.includes("Task paused awaiting approval (risky-tool)"))).toBe(true);
    expect(completion.some((l) => l.includes("Task failed"))).toBe(false);
  }, 30_000);

  it("finalizeRun emits a completion event with paused:true for a pause, and no paused flag otherwise", async () => {
    const completionOf = (result: Record<string, unknown>) =>
      Effect.gen(function* () {
        const logger = yield* makeObservableLogger({ live: false });
        yield* finalizeRun({
          ctx: {} as never,
          task: { id: "t-1" } as never,
          config: { logging: { live: true } } as never,
          eb: null,
          result: result as never,
          executionStartMs: Date.now(),
          entropyLog: [],
          executionSucceeded: false,
        }).pipe(Effect.provideService(ObservableLogger, logger));
        const buffer = yield* logger.getBuffer();
        return buffer.find((e) => e._tag === "completion");
      }).pipe(Effect.runPromise);

    const metadata = { tokensUsed: 3, cost: 0, stepsCount: 1 };
    const paused = await completionOf({
      success: false,
      metadata,
      awaitingApprovalFor: { gateId: "g", toolName: "risky-tool", args: {} },
    });
    expect(paused).toMatchObject({ _tag: "completion", success: false, paused: true });

    const failed = await completionOf({ success: false, metadata });
    expect(failed?._tag).toBe("completion");
    expect(failed && "paused" in failed ? failed.paused : undefined).toBeUndefined();
  });

  it("isPausedResult: approval or interaction pause only", () => {
    expect(isPausedResult({ success: false })).toBe(false);
    expect(isPausedResult({ success: true })).toBe(false);
    expect(isPausedResult({ success: false, awaitingApprovalFor: { toolName: "t" } })).toBe(true);
    expect(isPausedResult({ success: false, awaitingInteractionFor: { kind: "form" } })).toBe(true);
  });

  it("completionVerb: paused runs are not 'failed'; terminal runs keep the success verb", () => {
    expect(completionVerb({ success: false })).toBe("failed");
    expect(completionVerb({ success: true })).toBe("completed");
    expect(completionVerb({ success: false, awaitingApprovalFor: { toolName: "t" } })).toBe(
      "paused awaiting approval (t)",
    );
    expect(completionVerb({ success: false, awaitingInteractionFor: { kind: "form" } })).toBe(
      "paused awaiting interaction (form)",
    );
  });
});
