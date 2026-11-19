/**
 * Desk-run Continue as a NEW linked run (`agent.resumeRun(id, { newRun: true })`),
 * the same choice chat Continue makes (`chat-resume.ts` `continueOptions`).
 *
 * The framework mints the continuation's id (`<durableRunId>-cont-<8hex>`) inside
 * `resumeRun`, after the agent and its event subscription exist, so the forwarder
 * cannot be bound to a fixed Cortex run id like a fresh desk start. Instead it keys
 * every event by the event's own `taskId`: the first event carrying the continuation
 * id of THIS parent (`AgentStarted`) names the new run. Until then events are held;
 * at that moment the run row is filed with the parent's launch config (Rerun and a
 * later Continue need it), the run is registered as active under the new id (Stop,
 * Terminate and the live view address it), the held events flush, and the Continue
 * answers `{ agentId, runId: <new id> }`. The row's `continued_from` is filled by
 * ingest from `AgentStarted.config.continuedFrom`, like a chat continuation.
 * The parent's row and record are untouched; `resumableRunsOf` drops it from the
 * Continue lists once the child's record names it.
 */
import { Effect, Ref, type Context } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ReactiveAgent, ResumeRunOptions } from "@reactive-agents/runtime";
import { CortexError } from "../errors.js";
import type { CortexIngestService } from "./ingest-service.js";
import type { CortexStoreService } from "./store-service.js";
import type { CrashedRun } from "./crashed-runs.js";
import { continueOptions } from "./chat-resume.js";
import { errorText } from "./loop-stop-resume.js";
import { cortexLog, cortexLogRunnerExecution, formatErrorDetails } from "../cortex-log.js";
import type { ActiveEntry } from "./runner-service.js";

/** A desk run's stop request: set by stop()/terminate(), read when the run settles. */
export type StopControl = {
  requested?: "stop" | "terminate";
  /** The run published AgentStopped / AgentTerminated / ExecutionCancelled itself. */
  sawStopEvent: boolean;
};

/** Events by which a run ends because the user (or the framework) stopped it. */
export const STOP_EVENT_TAGS: ReadonlySet<string> = new Set(["AgentStopped", "AgentTerminated", "ExecutionCancelled"]);

/** Ingest a failed `AgentCompleted` so the UI leaves "loading" when a run rejected. */
export const ingestRunFailure = (
  ingest: Context.Tag.Service<typeof CortexIngestService>,
  agentId: string,
  runId: string,
  startedAt: number,
  err: unknown,
): Effect.Effect<void> =>
  ingest
    .handleEvent(agentId, runId, {
      v: 1,
      agentId,
      runId,
      event: {
        _tag: "AgentCompleted" as const,
        taskId: runId,
        agentId,
        success: false,
        totalIterations: 0,
        totalTokens: 0,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      },
    })
    .pipe(Effect.catchAll((e) => emitErrorSwallowed({ site: "cortex/server/services/desk-continue.ts:failure", tag: errorTag(e) })));

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The continuation id an event belongs to: its `taskId` when it is exactly
 * `<parentId>-cont-<8hex>` (what the framework mints); anything else (sub-agent
 * tasks, other runs) is `undefined`. Pure.
 */
export const continuationIdOf = (parentId: string, event: unknown): string | undefined => {
  const taskId: unknown = typeof event === "object" && event !== null ? Reflect.get(event, "taskId") : undefined;
  return typeof taskId === "string" && new RegExp(`^${escapeRe(parentId)}-cont-[0-9a-f]{8}$`).test(taskId) ? taskId : undefined;
};

/** What {@link makeDeskContinue} needs from the runner (captured at layer build, never read from context later). */
export interface DeskContinueDeps {
  readonly store: Context.Tag.Service<typeof CortexStoreService>;
  readonly ingest: Context.Tag.Service<typeof CortexIngestService>;
  readonly activeRef: Ref.Ref<Map<string, ActiveEntry>>;
  readonly finalizeRun: (runId: string, unsubscribe?: () => void, agent?: ReactiveAgent) => Effect.Effect<void>;
  /** Rebuild the run's agent from its stored launch config under the same agent id. */
  readonly buildAgent: (crashed: CrashedRun) => Effect.Effect<ReactiveAgent, CortexError>;
}

type Ready = { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly error: unknown };

/** The runner's `resumeCrashed`: continue an interrupted desk run as a new linked run. */
export const makeDeskContinue =
  (deps: DeskContinueDeps) =>
  (crashed: CrashedRun, resumeOpts?: ResumeRunOptions): Effect.Effect<{ agentId: string; runId: string }, CortexError> =>
    Effect.gen(function* () {
      const { runId: parentRunId, agentId, durableRunId, launch } = crashed;
      if ((yield* Ref.get(deps.activeRef)).has(parentRunId)) {
        return yield* Effect.fail(new CortexError({ message: `Run ${parentRunId} is already running` }));
      }
      const agent = yield* deps.buildAgent(crashed);
      const startedAt = Date.now();
      const control: StopControl = { sawStopEvent: false };

      let childId: string | undefined;
      const held: AgentEvent[] = [];
      let unsubscribe: () => void = () => {};
      let markSettled: () => void = () => {};
      const settled = new Promise<void>((resolve) => {
        markSettled = resolve;
      });
      let markReady: (r: Ready) => void = () => {};
      const ready = new Promise<Ready>((resolve) => {
        markReady = resolve;
      });

      const forward = (id: string, event: AgentEvent): void => {
        Effect.runFork(
          deps.ingest
            .handleEvent(agentId, id, { v: 1, agentId, runId: id, event })
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/desk-continue.ts:forward", tag: errorTag(err) }))),
        );
      };

      // The new run is named: file its row (with the launch config), register it, flush what was held.
      const attach = (id: string): void => {
        childId = id;
        Effect.runSync(
          deps.store
            .ensureRunRow(agentId, id, {
              ...(crashed.name ? { displayName: crashed.name } : {}),
              launchParamsJson: JSON.stringify(launch),
              // The PARENT'S CORTEX run id: the framework's own `continuedFrom` is its durable id, which differs
              // from the Cortex id of a desk run. Set before any event, so ingest's first-seen value never wins.
              continuedFrom: parentRunId,
            })
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/desk-continue.ts:row", tag: errorTag(err) }))),
        );
        Effect.runSync(Ref.update(deps.activeRef, (m) => new Map(m).set(id, { agentId, runId: id, agent, startedAt, unsubscribe, settled, control })));
        for (const e of held.splice(0)) forward(id, e);
        markReady({ ok: true, runId: id });
      };

      unsubscribe = yield* Effect.tryPromise({
        try: () =>
          agent.subscribe((event) => {
            if (STOP_EVENT_TAGS.has(event._tag)) control.sawStopEvent = true;
            if (childId !== undefined) return forward(childId, event);
            const id = continuationIdOf(durableRunId, event);
            if (id === undefined) {
              held.push(event);
              return;
            }
            attach(id);
            forward(id, event);
          }),
        catch: (e) => new CortexError({ message: `Failed to subscribe runner to agent events: ${String(e)}`, cause: e }),
      }).pipe(Effect.tapError(() => Effect.promise(() => agent.dispose()).pipe(Effect.ignore)));

      cortexLog("info", "runner", "continuing interrupted run as a new linked run", { agentId, runId: parentRunId, durableRunId });
      void agent
        .resumeRun(durableRunId, continueOptions(resumeOpts ?? {}))
        .then((result) => {
          // A run that ended without any event we could key: the result still names it.
          if (childId === undefined && typeof result.runId === "string") attach(result.runId);
          if (childId === undefined) markReady({ ok: false, error: new CortexError({ message: "The continued run reported no run id" }) });
        })
        .catch((err) => {
          cortexLogRunnerExecution("agent.resumeRun rejected", { agentId, runId: parentRunId, durableRunId, ...formatErrorDetails(err) });
          if (childId === undefined) markReady({ ok: false, error: err });
          else Effect.runFork(ingestRunFailure(deps.ingest, agentId, childId, startedAt, err));
        })
        .finally(() => {
          markSettled();
          if (childId !== undefined) void Effect.runPromise(deps.finalizeRun(childId, unsubscribe, agent));
          else {
            unsubscribe();
            void agent.dispose().catch(() => undefined);
          }
        });

      const outcome = yield* Effect.promise(() => ready);
      if (!outcome.ok) return yield* Effect.fail(new CortexError({ message: errorText(outcome.error), cause: outcome.error }));
      return { agentId, runId: outcome.runId };
    });
