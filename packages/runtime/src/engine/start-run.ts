/**
 * The runtime's ONE run entry (Plan 9 item 1R).
 *
 * Per-run state lives in one run scope (`@reactive-agents/core/internal/run-scope`).
 * Every entry that runs a task (run, runEffect, runDurable and the durable
 * facades that call it, resumeRun, runStream/chat, gateway events) wraps its
 * run effect in {@link startRun}, which opens that scope with `withRunScope`
 * and binds the runtime-owned slots. Later stages add slots here, in one
 * place. Sub-agents do not call this: they nest with `childRunScope`.
 *
 * Bindings:
 * - File root: the caller's `withFileRoot` root lives in AsyncLocalStorage,
 *   which Effect's scheduler does not keep (it resumes fibers in the ALS
 *   context of whichever fiber started the drain). {@link startRun} reads it
 *   SYNCHRONOUSLY when called, so call it where the run entry builds its
 *   effect; a caller that is already on a fiber (a facade) captures the root
 *   at its own synchronous entry and passes it as `spec.fileRoot`.
 * - Document store: the agent's store, provided in its runtime as
 *   {@link AgentDocumentStore} by `.withDocuments()` / any tool surface, or
 *   `spec.documentStore`. With neither, the slot keeps its process default.
 */
import { Context, Effect, Layer, Option } from "effect";
import * as path from "node:path";
import type { RunContext } from "@reactive-agents/core";
import { bindRun, withRunScope, type RunBinding } from "@reactive-agents/core/internal/run-scope";
import type { RagMemoryStore } from "@reactive-agents/tools";
import { capturedFileRoot, documentStoreSlot, fileRootSlot } from "@reactive-agents/tools/internal/run-slots";

/**
 * The agent's own document store, provided in the agent's runtime. Read by
 * {@link startRun} at each run entry; never read by tools (they read the
 * run slot).
 */
export class AgentDocumentStore extends Context.Tag("@reactive-agents/runtime/AgentDocumentStore")<
  AgentDocumentStore,
  RagMemoryStore
>() {}

/** Provide `store` as the agent's {@link AgentDocumentStore}. */
export const agentDocumentStoreLayer = (store: RagMemoryStore): Layer.Layer<AgentDocumentStore> =>
  Layer.succeed(AgentDocumentStore, store);

/**
 * A file root read at a synchronous entry. `root: undefined` means "the
 * caller had none" (file tools use `process.cwd()`), which differs from not
 * having captured at all.
 */
export interface CapturedRoot {
  readonly root: string | undefined;
}

/**
 * Read the caller's AsyncLocalStorage file root NOW. Call it at a synchronous
 * public entry when the run itself is built later on a fiber (durable facades).
 */
export const captureCallerFileRoot = (): CapturedRoot => ({ root: capturedFileRoot() });

/** What one run binds at its root entry. */
export interface StartRunSpec {
  /** The run's identity (`rootContext(taskId, agentId)`). */
  readonly context: RunContext;
  /** Overrides the agent's {@link AgentDocumentStore}. */
  readonly documentStore?: RagMemoryStore;
  /**
   * File root captured earlier by {@link captureCallerFileRoot}. Absent: the
   * AsyncLocalStorage root active when {@link startRun} is called.
   */
  readonly fileRoot?: CapturedRoot;
}

/**
 * Open the run scope for one run. Call it synchronously where the run entry
 * builds its effect (the file root is captured at call time); the returned
 * function wraps the run effect. The scope dies if a run scope is already
 * active on the fiber: a run nested in a run is a sub-agent (`childRunScope`).
 */
export const startRun = (spec: StartRunSpec) => {
  const captured = spec.fileRoot !== undefined ? spec.fileRoot.root : capturedFileRoot();
  const fileRoot = captured === undefined ? undefined : path.resolve(captured);
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(
      spec.documentStore !== undefined
        ? Effect.succeed(Option.some(spec.documentStore))
        : Effect.serviceOption(AgentDocumentStore),
      (store) => {
        const bindings: RunBinding[] = [bindRun(fileRootSlot, fileRoot)];
        if (Option.isSome(store)) bindings.push(bindRun(documentStoreSlot, store.value));
        return withRunScope(spec.context, ...bindings)(effect);
      },
    );
};
