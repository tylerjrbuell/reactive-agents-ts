// packages/runtime/src/server/endpoints.ts
/**
 * Mount-anywhere endpoint helpers for the agentic-UI kit.
 *
 * Each factory returns a plain `(req: Request) => Promise<Response>` handler so
 * they drop into any Web-standard router (Bun.serve, Hono, Next route handlers,
 * etc.) with no framework coupling. They wrap the durable-run machinery:
 *  - `createAgentEndpoint` — POST `{prompt}` → journaled SSE stream (seq-stamped
 *    when durable runs are configured; unstamped otherwise — attach/resume then
 *    unavailable). Enforces optional per-identity guards.
 *  - `createRunAttachEndpoint` — GET `?cursor=N` → replay journal `afterSeq=N`,
 *    prefixed with `RunAttached`, live-tailing while the run is still `running`.
 *  - `createInteractionEndpoint` / `createApprovalEndpoint` — POST a human
 *    response/decision that resumes a paused durable run.
 *  - `createInboxEndpoint` — GET → the resolved identity's durable runs.
 */
import type { ReactiveAgent } from "../reactive-agent.js";
import { createEndpointGuards, DEFAULT_LIMITS, type EndpointLimits } from "./guards.js";
import {
  enrichStream,
  openJournal,
  replaySSE,
  toJournaledSSE,
  type JournalHandle,
  type WireEvent,
} from "./journal.js";

export interface IdentityResolver {
  (req: Request): Promise<{ userId: string; orgId?: string } | null>;
}

export interface AgentEndpointOptions {
  readonly identify?: IdentityResolver;
  /** `false` disables all guards; omitted uses `DEFAULT_LIMITS`. */
  readonly limits?: EndpointLimits | false;
  readonly density?: "tokens" | "full";
}

const sseSingle = (
  event: Record<string, unknown>,
  headers?: Record<string, string>,
): Response =>
  new Response(`data: ${JSON.stringify(event)}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...headers },
  });

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

/**
 * POST `{prompt: string}` → journaled SSE. When the agent was built with
 * `.withDurableRuns()`, every emitted event is stamped `id: <seq>` and appended
 * to the run journal (enabling attach/replay); otherwise events flow unstamped.
 */
export const createAgentEndpoint = (agent: ReactiveAgent, opts: AgentEndpointOptions = {}) => {
  const guards =
    opts.limits === false ? undefined : createEndpointGuards(opts.limits ?? DEFAULT_LIMITS);

  return async (req: Request): Promise<Response> => {
    const identity = opts.identify ? await opts.identify(req) : null;
    const userId = identity?.userId ?? null;

    if (guards) {
      const decision = guards.checkRunStart(userId);
      if (!decision.allowed) {
        return sseSingle(
          { _tag: "LimitExceeded", kind: decision.kind, retryAfterMs: decision.retryAfterMs },
          decision.retryAfterMs !== undefined
            ? { "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)) }
            : undefined,
        );
      }
    }

    let body: { prompt?: unknown };
    try {
      body = (await req.json()) as { prompt?: unknown };
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    if (typeof body.prompt !== "string" || body.prompt.length === 0) {
      return json({ error: "body.prompt (string) is required" }, 400);
    }

    guards?.onRunStart(userId);
    const durable = agent.getDurableInfo();

    // Ordering guarantee this relies on: execute-stream creates the durable run
    // row (and thus the runId) BEFORE the first event is emitted, so `onRunId`
    // fires before any event flows. We resolve the journal handle from it.
    let resolveJournal: (j: JournalHandle | undefined) => void = () => {};
    const journalReady = new Promise<JournalHandle | undefined>((resolve) => {
      resolveJournal = resolve;
    });

    const raw = agent.runStream(body.prompt, {
      density: opts.density ?? "full",
      identity: identity ?? undefined,
      onRunId:
        durable === undefined
          ? undefined
          : (runId: string) => resolveJournal(openJournal(durable.dbPath, runId)),
    });
    if (durable === undefined) resolveJournal(undefined);

    async function* guarded(): AsyncGenerator<WireEvent> {
      try {
        for await (const event of enrichStream(raw)) {
          yield event;
          if (event._tag === "StreamCompleted" || event._tag === "StreamError") {
            const cost =
              event._tag === "StreamCompleted"
                ? ((event as { metadata?: { cost?: number } }).metadata?.cost ?? 0)
                : 0;
            guards?.onRunEnd(userId, cost);
          }
        }
      } catch (err) {
        guards?.onRunEnd(userId, 0);
        throw err;
      }
    }

    // Pull the first event before awaiting the journal so `onRunId` has fired;
    // then serialize the full (first + rest) sequence with the journal handle.
    const iterator = guarded()[Symbol.asyncIterator]();
    const first = await iterator.next();
    const journal = await journalReady;
    async function* withFirst(): AsyncGenerator<WireEvent> {
      if (!first.done) yield first.value;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    }
    return toJournaledSSE(withFirst(), journal);
  };
};

/**
 * GET `?cursor=N` → replay journal events with `seq > N` as SSE, prefixed by a
 * `RunAttached` head; while the run status is `running`, poll every 500ms and
 * stream new rows until a terminal event lands (v1 cross-request live-tail).
 */
export const createRunAttachEndpoint = (agent: ReactiveAgent) => {
  return async (req: Request, params: { runId: string }): Promise<Response> => {
    const durable = agent.getDurableInfo();
    if (!durable) return json({ error: "durable runs not configured" }, 404);
    const cursor = Number(new URL(req.url).searchParams.get("cursor") ?? "0");
    const journal = openJournal(durable.dbPath, params.runId);
    const status = await journal.status();
    if (status === undefined) return json({ error: "run not found" }, 404);

    async function* replay(): AsyncGenerator<{
      seq: number | undefined;
      event: Record<string, unknown>;
    }> {
      let last = Number.isFinite(cursor) ? cursor : 0;
      const existing = await journal.list(last);
      const head = {
        _tag: "RunAttached",
        runId: params.runId,
        status,
        resumeCursor: existing.at(-1)?.seq ?? last,
        protocolVersion: 1,
      };
      yield { seq: undefined, event: head };
      for (const row of existing) {
        last = row.seq;
        yield { seq: row.seq, event: row.event };
      }
      // live-tail while the run is still executing in some process
      while ((await journal.status()) === "running") {
        await new Promise((r) => setTimeout(r, 500));
        for (const row of await journal.list(last)) {
          last = row.seq;
          yield { seq: row.seq, event: row.event };
        }
      }
    }
    return replaySSE(replay());
  };
};

/** POST `{runId, interactionId, value}` → resume a run paused on `request_user_input`. */
export const createInteractionEndpoint = (agent: ReactiveAgent) => {
  return async (req: Request): Promise<Response> => {
    const body = (await req.json()) as { runId?: string; interactionId?: string; value?: unknown };
    if (typeof body.runId !== "string" || typeof body.interactionId !== "string") {
      return json({ error: "runId and interactionId are required" }, 400);
    }
    const result = await agent.respondToInteraction(body.runId, body.interactionId, body.value);
    return json({ success: result.success, output: result.output, runId: body.runId });
  };
};

/** GET → pending approvals; POST `{runId, decision, reason?}` → approve/deny + resume. */
export const createApprovalEndpoint = (agent: ReactiveAgent) => {
  return async (req: Request): Promise<Response> => {
    if (req.method === "GET") return json(await agent.listPendingApprovals());
    const body = (await req.json()) as { runId?: string; decision?: string; reason?: string };
    if (typeof body.runId !== "string" || (body.decision !== "approve" && body.decision !== "deny")) {
      return json({ error: "runId and decision ('approve'|'deny') required" }, 400);
    }
    const result =
      body.decision === "approve"
        ? await agent.approveRun(body.runId, { reason: body.reason })
        : await agent.denyRun(body.runId, body.reason ?? "denied via endpoint");
    return json({ success: result.success, output: result.output, runId: body.runId });
  };
};

/** GET → durable runs for the resolved identity (empty array if unresolved). */
export const createInboxEndpoint = (
  agent: ReactiveAgent,
  opts: { identify: IdentityResolver },
) => {
  return async (req: Request): Promise<Response> => {
    const identity = await opts.identify(req);
    if (identity === null) return json([], 200);
    const runs = await agent.listRuns({ userId: identity.userId });
    return json(
      runs.map((r) => ({ runId: r.runId, task: r.task, status: r.status, updatedAt: r.updatedAt })),
    );
  };
};
