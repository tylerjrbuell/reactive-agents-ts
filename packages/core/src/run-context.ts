/**
 * Ambient correlation for one agent run (or sub-run).
 *
 * THE AUTHORITY IS THE EXPLICIT VALUE. This is threaded through
 * `Task.metadata.context` and `LLMRequest.traceContext`. The active run scope
 * (`currentRunContext` in `@reactive-agents/core/internal/run-scope`) carries
 * it as a FALLBACK only — stream consumption can hop fibers, and fiber-local
 * state is not trustworthy across that hop (the bun 1.3.14
 * FiberRef-inheritance regression the project is pinned away from). A fallback
 * read yields run-scoped attribution; a miss yields today's placeholder.
 * Neither yields a WRONG attribution.
 */
export interface RunContext {
  /** The top-most run in this delegation tree. Stable across all descendants. */
  readonly rootRunId: string;
  /** This run. Unique per agent execution, including each sub-agent. */
  readonly runId: string;
  /** The agent executing this run. */
  readonly agentId: string;
  /** The run that spawned this one. Undefined at the root. */
  readonly parentRunId?: string;
  /** The agent that spawned this one. Undefined at the root. */
  readonly parentAgentId?: string;
  /** Delegation depth. 0 at the root. Enforced against maxRecursionDepth. */
  readonly depth: number;
  /** The parent's tool-call id that caused this spawn. Undefined at the root. */
  readonly spawnToolCallId?: string;
  /**
   * The task this run executes, when it differs from `runId` (a sub-agent's
   * runId descends from its parent's; its task id is its own). Read through
   * {@link runTaskId}.
   */
  readonly taskId?: string;
}

/** The task id a run executes: `taskId` when set, else `runId` (a root run's runId is its task id). */
export const runTaskId = (ctx: RunContext): string => ctx.taskId ?? ctx.runId;

/** Construct the correlation context for a top-level (root) agent run. */
export const rootContext = (runId: string, agentId: string): RunContext => ({
  rootRunId: runId,
  runId,
  agentId,
  depth: 0,
});

/**
 * Derive the correlation context for a sub-agent spawned by `parent`.
 * Keeps the tree's `rootRunId`, links `parentRunId`/`parentAgentId`, and
 * increments `depth`. The child's own `runId` is unique and descends from the
 * parent's so the delegation tree is reconstructable from ids alone.
 */
export const childContext = (
  parent: RunContext,
  childAgentId: string,
  spawnToolCallId?: string,
): RunContext => ({
  rootRunId: parent.rootRunId,
  runId: `${parent.runId}.${childAgentId}-${crypto.randomUUID().slice(0, 8)}`,
  agentId: childAgentId,
  parentRunId: parent.runId,
  parentAgentId: parent.agentId,
  depth: parent.depth + 1,
  spawnToolCallId,
});

/** Resolve the explicit value if given, else the ambient fallback, else null. */
export const contextOrFallback = (
  explicit: RunContext | undefined,
  ambient: RunContext | null,
): RunContext | null => explicit ?? ambient;
