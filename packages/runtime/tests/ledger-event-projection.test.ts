/**
 * `LedgerEntryAppended` PUBLIC stream projection + run_events journal pin
 * (Wave C.1 ledger-convergence, Task 8).
 *
 * Task 7 already wired `KernelHooks.onLedgerAppend` to publish
 * `LedgerEntryAppended` on the `EventBus` (packages/core/src/services/event-bus.ts)
 * exactly once per entry, in ledger `seq` order. Nothing projected that onto the
 * PUBLIC `runStream()` surface — a density:"full" consumer had no way to see the
 * live ledger feed. Byte-identical shape of gap to the B5 phase-events gap
 * (phase-events-stream.test.ts): declared/published internally, zero public
 * writers.
 *
 * This test file pins two things:
 *  1. STREAM PROJECTION — `execute-stream.ts` subscribes to `LedgerEntryAppended`
 *     and offers one `{ _tag: "LedgerEntry", entry, seq }` chunk per ledger entry
 *     onto the public `AgentStreamEvent` stream, gated on density:"full".
 *  2. JOURNAL PERSISTENCE — `journal.ts:85` (`store.appendRunEvent`) serializes
 *     EVERY event that flows through the public stream to `run_events`, with NO
 *     new code required — this is a zero-cost consequence of (1), pinned here so
 *     a future regression in the stream projection is caught by both angles.
 *
 * NAMING NOTE: the AgentStreamEvent union is discriminated by `_tag` (documented
 * at the top of stream-types.ts, and relied on by every consumer: toSSE,
 * enrichStream, AgentStream.collect(), ui-core protocol/events.ts). This file
 * uses `_tag: "LedgerEntry"` for the public chunk — NOT the bus event's own tag
 * name `"LedgerEntryAppended"` (that name denotes the raw bus/AgentEvent, one
 * batch of possibly-multiple entries; the public chunk is the per-entry
 * projection, matching the ToolCallStarted/PhaseStarted per-item pattern) — and
 * NOT a `type` field (every sibling chunk in this union uses `_tag`; introducing
 * `type` would silently break `_tag`-based narrowing for this one variant).
 *
 * Red-on-cut: delete the `.on("LedgerEntryAppended", ...)` block in
 * execute-stream.ts and the density:"full" assertions below go 0 → fail.
 *
 * Run: bun test packages/runtime/tests/ledger-event-projection.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ReactiveAgents, ReactiveAgentBuilder } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import { createAgentEndpoint } from "../src/server/endpoints.js";
import { RunStoreLive, RunStoreService } from "../src/services/run-store.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      { name: "input", type: "string" as const, description: "Input", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

async function buildAgent(name: string) {
  return ReactiveAgents.create()
    .withName(name)
    // The RunLedger + `onLedgerAppend` live tap only exist on the reasoning
    // kernel path (packages/reasoning/src/kernel/loop/runner.ts). Without
    // `.withReasoning()` the agent takes the single-step (non-kernel)
    // execution path — a different engine that never mints a RunLedger, so
    // `LedgerEntryAppended` is never published regardless of this task's
    // projection wiring. (B5's PhaseStarted/PhaseCompleted come from
    // `engine/pipeline.ts:runObservablePhase`, which is NOT kernel-gated —
    // that's why the B5 test harness didn't need this.)
    .withReasoning()
    .withTestScenario([
      { toolCall: { name: "echo-tool", args: { input: "hello" } } },
      { text: "FINAL ANSWER: done" },
    ])
    .withTools({
      tools: [
        {
          definition: makeToolDef("echo-tool"),
          handler: (args: Record<string, unknown>) =>
            Effect.succeed(`echoed: ${String(args.input)}`),
        },
      ],
    })
    // The tool-relevance classifier would otherwise burn the first scenario
    // turn on its own prompt (mirrors phase-events-stream.test.ts).
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(4)
    .build();
}

const sseEvents = async (
  res: Response,
): Promise<Array<{ seq?: number; e: { _tag: string } & Record<string, unknown> }>> => {
  const text = await res.text();
  const out: Array<{ seq?: number; e: { _tag: string } & Record<string, unknown> }> = [];
  let seq: number | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("id: ")) seq = Number(line.slice(4));
    if (line.startsWith("data: ")) {
      out.push({ seq, e: JSON.parse(line.slice(6)) });
      seq = undefined;
    }
  }
  return out;
};

const withStore = <A>(dbPath: string, f: (store: typeof RunStoreService.Service) => Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* RunStoreService;
      return yield* f(store);
    }).pipe(Effect.provide(RunStoreLive(dbPath))),
  );

describe("runStream() public handle — LedgerEntryAppended projection (Wave C.1 Task 8)", () => {
  test('density "full" delivers LedgerEntry chunks including a tool-invocation entry', async () => {
    const agent = await buildAgent("ledger-events-full");
    try {
      const events: AgentStreamEvent[] = [];
      for await (const event of agent.runStream("echo hello", { density: "full" })) {
        events.push(event);
      }

      const ledgerChunks = events.filter((e) => e._tag === "LedgerEntry") as Extract<
        AgentStreamEvent,
        { _tag: "LedgerEntry" }
      >[];

      // The gap: zero LedgerEntry chunks before the projection was wired.
      expect(ledgerChunks.length).toBeGreaterThan(0);

      // A tool-using scenario must have minted at least a tool-invocation
      // ledger entry, and it must have crossed onto the public stream.
      expect(
        ledgerChunks.some((c) => (c.entry as { kind?: string }).kind === "tool-invocation"),
      ).toBe(true);

      // seq is either the numeric seq carried on the entry, or -1 (brief
      // fallback) when the entry has no numeric seq.
      for (const c of ledgerChunks) {
        expect(typeof c.seq).toBe("number");
      }

      // Ordering guard (Task 8 critical hazard): anything queued after
      // StreamCompleted is never delivered to a consumer whose unfold stops
      // at the terminal tag (Arc-1 stream precedent, same guard as B5's
      // phase-events-stream.test.ts). EventBus.publish() (event-bus.ts)
      // fully awaits every subscriber handler via Effect.all before
      // resolving — including this projection's Queue.offer — so even the
      // runner's POST-onDone/onError final onLedgerAppend flush
      // (runner.ts:1470-1476) completes its Queue.offer(s) strictly before
      // `execute(task)`'s Effect resolves, which is strictly before
      // execute-stream.ts's `.tap` builds and offers StreamCompleted onto
      // the SAME queue. Verified empirically here: every ledger chunk,
      // including any minted by that final post-loop flush, precedes
      // StreamCompleted.
      const terminalIdx = events.findIndex((e) => e._tag === "StreamCompleted");
      expect(terminalIdx).toBeGreaterThanOrEqual(0);
      const lastLedgerIdx = events.findIndex((e) => e === ledgerChunks[ledgerChunks.length - 1]);
      expect(lastLedgerIdx).toBeLessThan(terminalIdx);
    } finally {
      await agent.dispose();
    }
  }, 15000);

  test("default density does NOT emit LedgerEntry chunks (opt-in via density:'full')", async () => {
    const agent = await buildAgent("ledger-events-default-density");
    try {
      const events: AgentStreamEvent[] = [];
      for await (const event of agent.runStream("echo hello")) events.push(event);
      expect(events.some((e) => e._tag === "LedgerEntry")).toBe(false);
      // …but the run still really minted ledger entries — this is a
      // projection policy, not an execution difference.
      const terminal = events.find((e) => e._tag === "StreamCompleted");
      expect(terminal).toBeDefined();
    } finally {
      await agent.dispose();
    }
  }, 15000);
});

describe("run_events journal — LedgerEntry persistence pin (Wave C.1 Task 8)", () => {
  test("a durable run's run_events rows include a LedgerEntry payload with a tool-invocation entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ledger-journal-"));
    const dbPath = join(dir, "runs.db");

    const agent = await new ReactiveAgentBuilder()
      .withName("ledger-journal-e2e")
      // See buildAgent() above — the ledger tap is kernel-only.
      .withReasoning()
      .withTestScenario([
        { toolCall: { name: "echo-tool", args: { input: "hello" } } },
        { text: "FINAL ANSWER: done" },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("echo-tool"),
            handler: (args: Record<string, unknown>) =>
              Effect.succeed(`echoed: ${String(args.input)}`),
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
          body: JSON.stringify({ prompt: "hi" }),
        }),
      );
      // Drain the full SSE body — journal.ts:85 (appendRunEvent) fires once
      // per event as toJournaledSSE iterates the underlying agent stream.
      const drained = await sseEvents(res);
      const runId = (drained.at(-1)!.e as { runId?: string }).runId;
      expect(runId).toBeDefined();

      // Journal pin also holds via the SSE wire (same events, before we even
      // touch the DB directly below).
      expect(drained.some((x) => x.e._tag === "LedgerEntry")).toBe(true);

      const rows = await withStore(dbPath, (store) => store.listRunEvents(runId!, 0));
      const ledgerRows = rows
        .map((r) => JSON.parse(r.eventJson) as { _tag: string; entry?: { kind?: string } })
        .filter((e) => e._tag === "LedgerEntry");

      expect(ledgerRows.length).toBeGreaterThan(0);
      expect(ledgerRows.some((e) => e.entry?.kind === "tool-invocation")).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 15000);
});
