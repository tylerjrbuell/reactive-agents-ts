// packages/runtime/src/server/journal.ts
/**
 * Journaled SSE serialization for the agentic-UI kit endpoints.
 *
 * Three responsibilities, split so `endpoints.ts` stays thin:
 *  - `enrichStream` — pass the raw agent stream through, injecting kit protocol
 *    events (pause markers + a final `CostDelta`) around `StreamCompleted`.
 *  - `openJournal` — a per-runId handle over the durable `RunStore` for appending
 *    stream events (assigning a monotonic `seq`), listing them from a cursor, and
 *    reading run status. Used both by the live journaling path and by attach/replay.
 *  - `toJournaledSSE` / `replaySSE` — serialize wire events to a `text/event-stream`
 *    `Response`, stamping `id: <seq>` lines so bindings can resume from a cursor.
 *
 * DURABILITY NOTE (v1): `openJournal` builds a fresh `RunStoreLive` layer per call,
 * which opens the SQLite file per operation. This mirrors the existing per-call
 * store idiom in `engine/durable-resume.ts` (listDurableRuns / markRunStatus / …),
 * so we keep it for consistency. Measurable overhead under load — logged as a GAP.
 */
import { Effect } from "effect";
import type { AgentStreamEvent } from "../stream-types.js";
import { RunStoreLive, RunStoreService } from "../services/run-store.js";

export type WireEvent = Record<string, unknown> & { _tag: string };

/** Enrich the raw agent stream with kit protocol events (pause markers, CostDelta). */
export async function* enrichStream(
  src: AsyncIterable<AgentStreamEvent>,
): AsyncGenerator<WireEvent> {
  for await (const event of src) {
    if (event._tag === "StreamCompleted") {
      const done = event as WireEvent & {
        metadata?: { tokensUsed?: number; cost?: number };
        runId?: string;
        pendingApproval?: { runId: string; gateId: string; toolName: string; args: unknown };
        pendingInteraction?: {
          runId: string;
          interactionId: string;
          kind: string;
          prompt: string;
          schema: unknown;
        };
      };
      if (done.pendingInteraction) {
        yield { _tag: "InteractionRequested", ...done.pendingInteraction };
        yield { _tag: "RunPaused", runId: done.pendingInteraction.runId, reason: "awaiting-interaction" };
      }
      if (done.pendingApproval) {
        yield { _tag: "ApprovalRequested", ...done.pendingApproval };
        yield { _tag: "RunPaused", runId: done.pendingApproval.runId, reason: "awaiting-approval" };
      }
      yield {
        _tag: "CostDelta",
        tokens: done.metadata?.tokensUsed ?? 0,
        usd: done.metadata?.cost ?? 0,
      };
      yield done;
      return;
    }
    yield event as WireEvent;
  }
}

export interface JournalHandle {
  /** Append an event at the next seq; returns the assigned seq. */
  append(event: WireEvent): Promise<number>;
  /** Journal rows with `seq > afterSeq`, ordered ascending. */
  list(afterSeq: number): Promise<Array<{ seq: number; event: WireEvent }>>;
  /** Current run lifecycle status, or undefined if the run row is unknown. */
  status(): Promise<string | undefined>;
}

export const openJournal = (dbPath: string, runId: string): JournalHandle => {
  const program = <A>(f: (store: typeof RunStoreService.Service) => Effect.Effect<A>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        return yield* f(store);
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
  return {
    append: (event) =>
      program((store) =>
        Effect.gen(function* () {
          const seq = yield* store.nextEventSeq(runId);
          yield* store.appendRunEvent(runId, seq, JSON.stringify(event));
          return seq;
        }),
      ),
    list: async (afterSeq) => {
      const rows = await program((store) => store.listRunEvents(runId, afterSeq));
      return rows.map((r) => ({ seq: r.seq, event: JSON.parse(r.eventJson) as WireEvent }));
    },
    status: async () => (await program((store) => store.getRun(runId)))?.status,
  };
};

/** Serialize wire events to SSE, stamping `id:` lines when a journal assigns seqs. */
export const toJournaledSSE = (
  events: AsyncIterable<WireEvent>,
  journal: JournalHandle | undefined,
): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          if (journal) {
            const seq = await journal.append(event);
            controller.enqueue(encoder.encode(`id: ${seq}\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ _tag: "StreamError", cause })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};

/** Serialize pre-stamped events to SSE without re-journaling (attach/replay path). */
export const replaySSE = (
  rows: AsyncIterable<{ seq: number | undefined; event: Record<string, unknown> }>,
): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const { seq, event } of rows) {
          if (seq !== undefined) controller.enqueue(encoder.encode(`id: ${seq}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
};
