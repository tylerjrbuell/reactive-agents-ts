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
 * - File root: the agent's working directory. Precedence: the run's
 *   `workspace` option (`spec.workspace`), then the builder's
 *   `.withTools({ workspace })` (provided as {@link AgentWorkspace}), then the
 *   caller's ambient `withFileRoot` root, then none (`process.cwd()`).
 *   The caller's `withFileRoot` root lives in AsyncLocalStorage,
 *   which Effect's scheduler does not keep (it resumes fibers in the ALS
 *   context of whichever fiber started the drain). {@link startRun} reads it
 *   SYNCHRONOUSLY when called, so call it where the run entry builds its
 *   effect; a caller that is already on a fiber (a facade) captures the root
 *   at its own synchronous entry and passes it as `spec.fileRoot`.
 * - Document store: the agent's store, provided in its runtime as
 *   {@link AgentDocumentStore} by `.withDocuments()` / any tool surface, or
 *   `spec.documentStore`. With neither, the slot keeps its process default.
 */
import { Context, Effect, Either, Layer, Option } from "effect";
import { statSync } from "node:fs";
import * as path from "node:path";
import { ToolsOptionError } from "../errors.js";
import type { ApprovalDecision, InteractionResponse, RunContext, RunControllerLike, ToolEffectRecord } from "@reactive-agents/core";
import {
  approvalDecisionSlot,
  bindRun,
  interactionResponseSlot,
  modelOverrideSlot,
  recoveredToolEffectsSlot,
  resumeStateSlot,
  runControllerSlot,
  withRunScope,
  type RunBinding,
} from "@reactive-agents/core/internal/run-scope";
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
 * The agent's working directory from `.withTools({ workspace })`: an absolute
 * path to an existing directory, validated when the wither ran. Provided in
 * the agent's runtime; {@link startRun} binds it as the run's file root
 * unless the run passes its own `workspace`.
 */
export class AgentWorkspace extends Context.Tag("@reactive-agents/runtime/AgentWorkspace")<
  AgentWorkspace,
  string
>() {}

/** Provide `dir` (absolute, validated) as the agent's {@link AgentWorkspace}. */
export const agentWorkspaceLayer = (dir: string): Layer.Layer<AgentWorkspace> => Layer.succeed(AgentWorkspace, dir);

/** Options-bag mixin for the run entries that accept a per-run working directory. */
export interface WorkspaceOption {
  /**
   * Working directory for this run only, overriding `.withTools({ workspace })`
   * and any ambient `withFileRoot()`. File tools resolve relative paths against
   * it and refuse paths outside it; `shell-execute` runs with it as its cwd.
   * Relative paths resolve against `process.cwd()`. Must be an existing
   * directory, or the run fails with `ToolsOptionError`.
   */
  readonly workspace?: string;
}

/** Spread-ready carrier: `{ workspace }` when set, `{}` otherwise. */
export const workspaceCarry = (workspace?: string): { workspace?: string } =>
  workspace !== undefined ? { workspace } : {};

/**
 * Resolve a workspace to an absolute directory path. Fails with
 * `ToolsOptionError` (option `"workspace"`) when the value is not a non-empty
 * string, does not exist, or is not a directory. `label` names the API in
 * the message (`"withTools({ workspace })"`, `"run({ workspace })"`).
 */
export const resolveWorkspaceDir = (raw: unknown, label: string): Either.Either<string, ToolsOptionError> => {
  const fail = (why: string) =>
    Either.left(new ToolsOptionError({ option: "workspace", message: `${label}: ${why}` }));
  if (typeof raw !== "string" || raw.trim() === "") return fail("must be a non-empty directory path.");
  const dir = path.resolve(raw);
  const stat = statSync(dir, { throwIfNoEntry: false });
  if (stat === undefined) return fail(`'${dir}' does not exist. Create the directory first.`);
  if (!stat.isDirectory()) return fail(`'${dir}' is not a directory.`);
  return Either.right(dir);
};

/**
 * Read the caller's AsyncLocalStorage file root NOW. Call it at a synchronous
 * public entry when the run itself is built later on a fiber (durable facades).
 * `null` means "captured: the caller had none" (file tools use
 * `process.cwd()`), which differs from not having captured at all (`undefined`).
 */
export const captureCallerFileRoot = (): string | null => capturedFileRoot() ?? null;

/** What one run binds at its root entry. */
export interface StartRunSpec {
  /** The run's identity (`rootContext(taskId, agentId)`). */
  readonly context: RunContext;
  /** Overrides the agent's {@link AgentDocumentStore}. */
  readonly documentStore?: RagMemoryStore;
  /**
   * File root captured earlier by {@link captureCallerFileRoot} (`null`:
   * captured, none). Absent: the AsyncLocalStorage root active when
   * {@link startRun} is called.
   */
  readonly fileRoot?: string | null;
  /**
   * The run's own working directory (absolute, already validated with
   * {@link resolveWorkspaceDir}). Wins over the agent's {@link AgentWorkspace}
   * and over `fileRoot`.
   */
  readonly workspace?: string;
  /** Per-run values the public entry knows before the run starts. */
  readonly state?: RunStateSpec;
}

/**
 * Run state a public entry hands to its run: `runStream()` and durable runs
 * bind a controller; `fork({ model })` a model; resume, approve/deny and
 * `respondToInteraction` the checkpoint and the human's answer; crash
 * recovery the tool effects that already happened.
 */
export interface RunStateSpec {
  readonly runController?: RunControllerLike;
  readonly modelOverride?: string;
  readonly resumeState?: string;
  readonly approvalDecision?: ApprovalDecision;
  readonly interactionResponse?: InteractionResponse;
  readonly recoveredToolEffects?: Map<string, ToolEffectRecord>;
}

const stateBindings = (state: RunStateSpec | undefined): RunBinding[] => {
  if (state === undefined) return [];
  const out: RunBinding[] = [];
  if (state.runController !== undefined) out.push(bindRun(runControllerSlot, state.runController));
  if (state.modelOverride !== undefined) out.push(bindRun(modelOverrideSlot, state.modelOverride));
  if (state.resumeState !== undefined) out.push(bindRun(resumeStateSlot, state.resumeState));
  if (state.approvalDecision !== undefined) out.push(bindRun(approvalDecisionSlot, state.approvalDecision));
  if (state.interactionResponse !== undefined) out.push(bindRun(interactionResponseSlot, state.interactionResponse));
  if (state.recoveredToolEffects !== undefined) out.push(bindRun(recoveredToolEffectsSlot, state.recoveredToolEffects));
  return out;
};

/**
 * Open the run scope for one run. Call it synchronously where the run entry
 * builds its effect (the file root is captured at call time); the returned
 * function wraps the run effect. The scope dies if a run scope is already
 * active on the fiber: a run nested in a run is a sub-agent (`childRunScope`).
 */
export const startRun = (spec: StartRunSpec) => {
  const captured = spec.fileRoot !== undefined ? spec.fileRoot : capturedFileRoot();
  const ambientRoot = captured == null ? undefined : path.resolve(captured);
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(
      Effect.all([
        spec.documentStore !== undefined
          ? Effect.succeed(Option.some(spec.documentStore))
          : Effect.serviceOption(AgentDocumentStore),
        Effect.serviceOption(AgentWorkspace),
      ]),
      ([store, agentWorkspace]) => {
        const fileRoot = spec.workspace ?? Option.getOrUndefined(agentWorkspace) ?? ambientRoot;
        const bindings: RunBinding[] = [bindRun(fileRootSlot, fileRoot), ...stateBindings(spec.state)];
        if (Option.isSome(store)) bindings.push(bindRun(documentStoreSlot, store.value));
        return withRunScope(spec.context, ...bindings)(effect);
      },
    );
};
