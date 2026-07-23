import { Schema } from "effect";
import { AgentId } from "./agent.js";
import { TaskId } from "./task.js";

// ─── Reasoning Step ───

export const StepType = Schema.Literal(
  "thought",
  "action",
  "observation",
  "plan",
  "reflection",
  "critique",
);
export type StepType = typeof StepType.Type;

export const ReasoningStepSchema = Schema.Struct({
  id: Schema.String,
  type: StepType,
  content: Schema.String,
  timestamp: Schema.DateFromSelf,
  metadata: Schema.optional(
    Schema.Struct({
      confidence: Schema.optional(Schema.Number),
      toolUsed: Schema.optional(Schema.String),
      cost: Schema.optional(Schema.Number),
      duration: Schema.optional(Schema.Number),
    }),
  ),
});
export type ReasoningStep = typeof ReasoningStepSchema.Type;

// ─── Result Metadata ───

export const ResultMetadataSchema = Schema.Struct({
  duration: Schema.Number,
  cost: Schema.Number,
  /**
   * Canonical token-count field. Always populated equal to `totalTokens`.
   * See GH #126 — other framework surfaces (`AgentCompleted` event,
   * `ReasoningResult.totalTokens`, `traceStats.totalTokens`) use the
   * `totalTokens` name; consumers expecting that name read it from this
   * metadata via the optional alias below.
   */
  tokensUsed: Schema.Number,
  /**
   * Alias of `tokensUsed`. Added 2026-05-24 to close the naming
   * inconsistency tracked in GH #126 — `AgentCompleted.totalTokens` /
   * `ReasoningResult.totalTokens` / `traceStats.totalTokens` use this
   * name, only `ResultMetadata` was the outlier. Both fields are now
   * always populated to the same value; consumers may use either.
   * No deprecation — `tokensUsed` remains canonical per #104 reversal.
   */
  totalTokens: Schema.optional(Schema.Number),
  /**
   * Prompt/input tokens consumed across all LLM calls in this execution.
   * Optional — providers/strategies may not always split (e.g. test-provider,
   * sub-agent rollups). Sum should equal `tokensUsed` when both present.
   */
  inputTokens: Schema.optional(Schema.Number),
  /**
   * Completion/output tokens generated across all LLM calls in this execution.
   * Optional — see `inputTokens` for cases where this may be absent.
   */
  outputTokens: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Literal("high", "medium", "low")),
  strategyUsed: Schema.optional(Schema.String),
  stepsCount: Schema.optional(Schema.Number),
  iterations: Schema.optional(Schema.Number),
  /** Derived task-complexity bucket ("trivial" | "moderate" | "complex" | "expert"). */
  complexity: Schema.optional(Schema.String),
  /** Total LLM calls made across this execution. */
  llmCalls: Schema.optional(Schema.Number),
  /**
   * Terminal judgment record (cross-cutting cascade, 2026-07-22/23).
   * Forwarded verbatim from `ReasoningMetadataSchema.verdict` (Task 9) so
   * trust receipts can read the terminal judgment off `TaskResult` — see
   * `ReasoningMetadataSchema` in `@reactive-agents/reasoning` for the
   * canonical field documentation; kept identical here.
   */
  verdict: Schema.optional(
    Schema.Struct({
      /** Did judgment alter the result (status flip / output replacement)? */
      enforced: Schema.Boolean,
      /** Grounding verdict against required tools, when requiredTools were declared. */
      groundedOnRequired: Schema.optional(Schema.Boolean),
      /** Contract requirement outcomes, when a taskContract was declared. */
      contractSatisfied: Schema.optional(Schema.Boolean),
      /**
       * Names of judgment checks that failed. Empty means clean OR
       * unjudged — the mint only pushes "grounding-on-required" when
       * `envelope.policy.fabricationGuard` is configured, so an ungrounded
       * run with no guard set also reports `failed: []`. Do not read an
       * empty array as proof the run was checked and passed.
       */
      failed: Schema.Array(Schema.String),
      /** Declared repair gaps for this strategy (e.g. "per-iteration"). */
      repairGaps: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  /**
   * Namespaced, schema-typed extension slot (cross-cutting cascade Task 9,
   * DEBT-REGISTER §3). Strategy-contributed metadata fields that have no
   * dedicated top-level forward ride here — closes the failure mode where
   * a new field died silently at the engine boundary until someone
   * enumerated it by name. Deliberately NOT a deny-list pass-through: an
   * unenumerated TOP-LEVEL key on `ReasoningMetadata` still never reaches
   * `TaskResult` (that would leak internal fields onto the public API
   * surface). Only fields a strategy explicitly places under `extensions`
   * are forwarded, verbatim, one level deep.
   */
  extensions: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
export type ResultMetadata = typeof ResultMetadataSchema.Type;

// ─── Output Format & Termination Reason ───

export const OutputFormat = Schema.Literal("text", "json", "markdown", "csv", "html");
export type OutputFormat = typeof OutputFormat.Type;

export const TerminatedBy = Schema.Literal(
  "final_answer_tool",
  "final_answer",
  "max_iterations",
  "end_turn",
  /** LLM request/stream failed (provider error, invalid tool schema, network, etc.) */
  "llm_error",
  /** Agent honestly declined — could not ground an answer / required input unavailable. */
  "abstained",
);
export type TerminatedBy = typeof TerminatedBy.Type;

// ─── Task Result ───

export const TaskResultSchema = Schema.Struct({
  taskId: TaskId,
  agentId: AgentId,
  output: Schema.Unknown,
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  metadata: ResultMetadataSchema,
  completedAt: Schema.DateFromSelf,
});
export type TaskResult = typeof TaskResultSchema.Type;
