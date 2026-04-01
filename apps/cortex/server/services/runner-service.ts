/**
 * Launches local Reactive Agents from the Cortex UI (`POST /api/runs`).
 * Events flow through `CortexReporter` → ingest; run rows use the framework **task id** as `run_id`.
 * We pre-generate that task id, register `cortex_runs` before `run()`, and return **`{ agentId, runId }`**
 * so the UI can navigate immediately without polling for the first EventBus event.
 */
import { Effect, Context, Layer, Ref } from "effect";
import { generateTaskId } from "@reactive-agents/core";
import { ReactiveAgents, type ProviderName } from "@reactive-agents/runtime";
import type { RunId } from "../types.js";
import { CortexError } from "../errors.js";
import { CortexIngestService } from "./ingest-service.js";
import { CortexStoreService } from "./store-service.js";
import { cortexLog, cortexLogRunnerExecution } from "../cortex-log.js";

export interface LaunchParams {
  readonly prompt: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tools?: string[];
}

type ActiveEntry = {
  readonly agentId: string;
  readonly startedAt: number;
};

export class CortexRunnerService extends Context.Tag("CortexRunnerService")<
  CortexRunnerService,
  {
    readonly start: (params: LaunchParams) => Effect.Effect<
      { agentId: string; runId: string },
      CortexError
    >;
    readonly pause: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly stop: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly getActive: () => Effect.Effect<ReadonlyMap<string, ActiveEntry>, never>;
  }
>() {}

const defaultCortexHttpUrl = (): string =>
  process.env.CORTEX_URL?.replace(/^ws/, "http") ?? "http://127.0.0.1:4321";

export const CortexRunnerServiceLive = Layer.effect(
  CortexRunnerService,
  Effect.gen(function* () {
    // Services captured here during Layer composition — NOT inside method bodies.
    // Effect-TS Layer context is only available during build time; method closures
    // must reference captured values, not yield from the service context.
    const store = yield* CortexStoreService;
    const ingest = yield* CortexIngestService;
    const activeRef = yield* Ref.make(new Map<string, ActiveEntry>());

    return {
      start: (params) =>
        Effect.gen(function* () {
          const providerRaw = params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test";

          const agent = yield* Effect.tryPromise({
            try: async () => {
              let b = ReactiveAgents.create()
                .withName(`cortex-desk-${Date.now()}`)
                .withProvider(providerRaw as ProviderName)
                .withReasoning()  // ensures ReasoningIterationProgress + LLMRequestCompleted events
                .withMemory();    // ensures MemoryBootstrapped + MemoryFlushed events
              if (params.model?.trim()) {
                b = b.withModel(params.model.trim());
              }
              if (params.tools && params.tools.length > 0) {
                b = b.withTools();
              }
              return b.build();
            },
            catch: (e) => new CortexError({ message: `Failed to build agent: ${String(e)}`, cause: e }),
          });

          const agentId = agent.agentId;
          const runId = generateTaskId();
          const startedAt = Date.now();

          yield* store.ensureRunRow(agentId, runId);
          yield* Ref.update(activeRef, (m) => new Map(m).set(agentId, { agentId, startedAt }));
          let forwardedEvents = 0;

          const unsubscribe = yield* Effect.tryPromise({
            try: () =>
              agent.subscribe((event) => {
                forwardedEvents += 1;
                if (forwardedEvents === 1 || forwardedEvents % 25 === 0) {
                  cortexLog("debug", "runner", "forwarding agent event to ingest", {
                    agentId,
                    runId,
                    n: forwardedEvents,
                    tag: event._tag,
                  });
                }
                Effect.runFork(
                  ingest
                    .handleEvent(agentId, runId, {
                      v: 1,
                      agentId,
                      runId,
                      event,
                    })
                    .pipe(Effect.catchAll(() => Effect.void)),
                );
              }),
            catch: (e) =>
              new CortexError({
                message: `Failed to subscribe runner to agent events: ${String(e)}`,
                cause: e,
              }),
          });

          const cortexHttp = defaultCortexHttpUrl();
          cortexLog("info", "runner", "starting agent.run (events piped directly to ingest)", {
            agentId,
            runId,
            provider: providerRaw,
            cortexUrl: cortexHttp,
            tools: params.tools?.length ? params.tools : [],
            promptChars: params.prompt.length,
          });

          void agent
            .run(params.prompt, { taskId: runId })
            .catch((err) => {
              cortexLogRunnerExecution("agent.run rejected or threw", {
                agentId,
                runId,
                error: err instanceof Error ? err.message : String(err),
              });
            })
            .finally(() => {
              try {
                unsubscribe();
              } catch {
                // ignore unsubscribe errors in fire-and-forget path
              }
              void Effect.runPromise(
                Ref.update(activeRef, (m) => {
                  const copy = new Map(m);
                  copy.delete(agentId);
                  return copy;
                }),
              );
            });

          return { agentId, runId };
        }),

      pause: (runId) =>
        Effect.log(`Pause requested for run ${runId} (not yet wired to execution engine)`),

      stop: (runId) =>
        Effect.gen(function* () {
          yield* Ref.update(activeRef, (m) => {
            const copy = new Map(m);
            copy.delete(String(runId));
            return copy;
          });
          yield* Effect.log(`Stop recorded for ${runId} (abort/dispose wiring is limited in this MVP)`);
        }),

      getActive: () => Ref.get(activeRef),
    };
  }),
);
