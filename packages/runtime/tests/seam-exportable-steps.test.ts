// Run: bun test packages/runtime/tests/seam-exportable-steps.test.ts --timeout 20000
//
// Exportable-steps seam (Plan 9 Phase 4 stage F, result boundary). A tool that
// returns `toolContent([text, image])` leaves its typed parts on the step as
// `metadata.contentParts`, inline base64 included. Those steps ride out of the
// engine as `TaskResult.metadata.reasoningSteps`, and from there onto
// `StreamCompleted.metadata` (SSE wire), the durable `run_events` row, and the
// returned results. engine/exportable-steps.ts stubs every inline media part at
// the one assembly site (engine/execute-result-assembly.ts).
//
//   P1 — assembleTaskResult: the exported steps carry the stub, never the
//        base64 payload; in-run ctx.metadata.reasoningSteps stays raw; a
//        text-only step list is forwarded by reference.
//   P2 — runStream end to end through the agent endpoint with durable runs:
//        the StreamCompleted SSE payload and the run_events row read back hold
//        the stubbed step, not the payload.
//
// Red-on-cut: replace `exportableSteps(ctx.metadata.reasoningSteps)` with
// `ctx.metadata.reasoningSteps` in execute-result-assembly.ts; P1 and P2 fail.
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { ContentPart, Task, TaskId, AgentId } from "@reactive-agents/core";
import { toolContent } from "@reactive-agents/tools";
import { assembleTaskResult } from "../src/engine/execute-result-assembly.js";
import { exportableSteps, type ExportableStep } from "../src/engine/exportable-steps.js";
import type { ExecutionContext } from "../src/types.js";
import { ReactiveAgentBuilder } from "../src/builder.js";
import { createAgentEndpoint } from "../src/server/endpoints.js";
import { RunStoreLive, RunStoreService } from "../src/services/run-store.js";

// A distinctive base64 payload: 4,000 chars, decodes to "ABC" x 1,000.
const PAYLOAD = "QUJD".repeat(1000);
const IMAGE_PART: ContentPart = { type: "image", source: { type: "base64", media_type: "image/png", data: PAYLOAD } };
const URL_PART: ContentPart = { type: "image", source: { type: "url", media_type: "image/png", data: "https://x/y.png" } };
const TEXT_PART: ContentPart = { type: "text", text: "Chart rendered" };
const STUB = /^\[image omitted from record: image\/png, 3000 bytes, sha256:[0-9a-f]{12}\]$/;

const mediaStep = (): ExportableStep => {
  const metadata = { toolUsed: "render-chart", contentParts: [TEXT_PART, IMAGE_PART, URL_PART] };
  return { id: "s2", type: "observation", content: "Chart rendered", metadata };
};
const textStep: ExportableStep = { id: "s1", type: "thought", content: "rendering", metadata: { toolUsed: "render-chart" } };

const partsOf = (step: unknown): readonly unknown[] => {
  const meta = (step as { metadata?: { contentParts?: readonly unknown[] } }).metadata;
  return meta?.contentParts ?? [];
};

function makeCtx(steps: readonly ExportableStep[]): ExecutionContext {
  return {
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "complete",
    agentState: "completed",
    iteration: 2,
    maxIterations: 4,
    messages: [],
    toolResults: [],
    cost: 0,
    tokensUsed: 0,
    startedAt: new Date(),
    metadata: { reasoningSteps: steps },
  };
}

const TASK: Task = {
  id: "t1" as TaskId,
  agentId: "a1" as AgentId,
  type: "query",
  input: { question: "render" },
  priority: "medium",
  status: "running",
  metadata: { tags: [] },
  createdAt: new Date(),
};

const assemble = (ctx: ExecutionContext) =>
  assembleTaskResult({
    task: TASK,
    ctx,
    rr: undefined,
    verificationOutcome: { output: "done", success: true, blocked: false },
    executionDurationMs: 1,
    outputForSuccess: "done",
    toolCallLog: [],
    entropyLog: [],
    terminatedByRaw: "final_answer",
    debrief: undefined,
    boundaryVerification: undefined,
    traceLinkage: null,
    ambientRunMeter: null,
  });

const exportedSteps = (result: { metadata: unknown }): readonly unknown[] =>
  (result.metadata as { reasoningSteps?: readonly unknown[] }).reasoningSteps ?? [];

describe("P1 — assembleTaskResult exports steps without inline media", () => {
  it("stubs the inline image, keeps text and URL parts, leaves the in-run steps raw", () => {
    const raw = [textStep, mediaStep()];
    const ctx = makeCtx(raw);
    const result = assemble(ctx);

    const out = exportedSteps(result);
    expect(out.length).toBe(2);
    expect(JSON.stringify(result.metadata)).not.toContain(PAYLOAD);
    const parts = partsOf(out[1]);
    expect(parts.length).toBe(3);
    expect(parts[0]).toEqual(TEXT_PART);
    expect((parts[1] as { type: string; text: string }).type).toBe("text");
    expect((parts[1] as { text: string }).text).toMatch(STUB);
    expect(parts[2]).toEqual(URL_PART);
    // Untouched siblings and step fields ride through.
    expect(out[0]).toBe(textStep);
    expect((out[1] as ExportableStep).metadata?.toolUsed).toBe("render-chart");

    // In-run readers keep the bytes.
    expect(ctx.metadata.reasoningSteps).toBe(raw);
    expect(JSON.stringify(ctx.metadata.reasoningSteps)).toContain(PAYLOAD);
  });

  it("forwards a list with no inline media by reference", () => {
    const raw = [textStep];
    expect(exportableSteps(raw)).toBe(raw);
    expect(exportedSteps(assemble(makeCtx(raw)))).toBe(raw);
  });
});

// ── P2 ──────────────────────────────────────────────────────────────────────

const sseEvents = async (res: Response): Promise<Array<{ _tag: string } & Record<string, unknown>>> => {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as { _tag: string } & Record<string, unknown>);
};

const withStore = <A>(dbPath: string, f: (store: typeof RunStoreService.Service) => Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* RunStoreService;
      return yield* f(store);
    }).pipe(Effect.provide(RunStoreLive(dbPath))),
  );

/** Every step in a StreamCompleted payload that carries contentParts. */
const stepsWithParts = (completed: Record<string, unknown>): readonly unknown[] => {
  const steps = (completed["metadata"] as { reasoningSteps?: readonly unknown[] } | undefined)?.reasoningSteps ?? [];
  return steps.filter((s) => partsOf(s).length > 0);
};

describe("P2 — runStream: StreamCompleted and run_events carry no inline media", () => {
  it("the SSE StreamCompleted payload and the journal row hold the stub, not the payload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-exportable-steps-"));
    const dbPath = join(dir, "runs.db");
    const agent = await new ReactiveAgentBuilder()
      .withName("exportable-steps-e2e")
      .withReasoning()
      .withTestScenario([
        { toolCall: { name: "render-chart", args: { spec: "bar" } } },
        { text: "FINAL ANSWER: the chart is rendered." },
      ])
      .withTools({
        tools: [
          {
            definition: {
              name: "render-chart",
              description: "render a chart",
              parameters: [{ name: "spec", type: "string" as const, description: "chart spec", required: true }],
              riskLevel: "low" as const,
              timeoutMs: 5_000,
              requiresApproval: false,
              source: "function" as const,
            },
            handler: () => Effect.succeed(toolContent([TEXT_PART, IMAGE_PART])),
          },
        ],
      })
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(4)
      .withDurableRuns({ dir })
      .build();

    try {
      const handler = createAgentEndpoint(agent, { limits: false });
      const res = await handler(
        new Request("http://x/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "render a bar chart" }),
        }),
      );
      const events = await sseEvents(res);
      const completed = events.find((e) => e._tag === "StreamCompleted");
      expect(completed).toBeDefined();
      const runId = completed!["runId"] as string | undefined;
      expect(runId).toBeDefined();

      // Not vacuous: the media step really reached the result, as a stub.
      const wireSteps = stepsWithParts(completed!);
      expect(wireSteps.length).toBeGreaterThan(0);
      expect(JSON.stringify(completed)).not.toContain(PAYLOAD);
      expect(partsOf(wireSteps[0]).some((p) => STUB.test((p as { text?: string }).text ?? ""))).toBe(true);

      const rows = await withStore(dbPath, (store) => store.listRunEvents(runId!, 0));
      const journaled = rows
        .map((r) => JSON.parse(r.eventJson) as { _tag: string } & Record<string, unknown>)
        .find((e) => e._tag === "StreamCompleted");
      expect(journaled).toBeDefined();
      expect(stepsWithParts(journaled!).length).toBeGreaterThan(0);
      for (const r of rows) expect(r.eventJson).not.toContain(PAYLOAD);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
