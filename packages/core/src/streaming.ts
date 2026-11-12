// Per-run state (stream sink, controller, resume/approval/interaction state,
// model override, recovered tool effects) lives in run slots:
// `@reactive-agents/core/internal/run-scope` (Plan 9 1R). This module keeps
// the shapes those slots carry.

/** Minimal interface accessed by runner.ts for pause/stop control. */
export interface RunControllerLike {
  /**
   * Polled at each kernel iteration boundary. Resolves `{ stop: true }` for a
   * graceful stop() and `{ stop: true; terminate: true }` for a hard
   * terminate() — both exit the loop before its next provider call, but
   * `terminate` lets the loop route the kernel's own `terminate()` helper
   * through a distinct reason (FM-5) rather than mislabeling a hard abort as
   * `stop_requested`.
   */
  checkpoint(): Promise<{ stop: true; terminate?: boolean } | undefined>;
  /**
   * Optional abort signal mirroring `terminate()` (FM-5). When present, a
   * caller that owns the producer side of a run (e.g. the streaming engine's
   * forked pipeline fiber) can listen for `"abort"` to interrupt in-flight
   * work immediately rather than waiting for the next cooperative
   * `checkpoint()` poll. Absent on controllers that don't back a real
   * AbortController (e.g. simple test doubles) — always optional.
   */
  readonly signal?: AbortSignal;
  /**
   * Optional durable-checkpoint observer. The kernel invokes it at each
   * iteration boundary (same point as checkpoint()) with a LOSSLESS serialized
   * snapshot of kernel state (produced by the kernel's codec) plus the
   * iteration number. The string is opaque to core; a durable controller
   * persists it (e.g. every-N-iterations to a RunStore) and Phase C's resume()
   * rehydrates it. Must not throw and must not block the loop — fire-and-forget
   * persistence belongs inside the implementation. Absent on the default
   * in-process controller, so the kernel pays zero cost unless durability is
   * enabled.
   */
  onCheckpoint?(serializedState: string, iteration: number): void;
  /**
   * Always-on introspection seam (Arc 1 Task 5) — independent of
   * `onCheckpoint`/durable persistence. The kernel invokes this at every
   * iteration boundary with a LAZY snapshot thunk (not a pre-serialized
   * string): the thunk is only invoked when a caller later calls
   * `RunHandle.inspect()`. This keeps non-durable runs at zero
   * per-iteration serialization cost — `RunController.inspect()` stores the
   * thunk and defers execution until inspection is actually requested. On
   * durable runs the kernel may pass `() => serialized` reusing the string
   * already produced for `onCheckpoint` (no extra work either way). Must
   * not throw and must not block the loop.
   */
  noteCheckpoint?(snapshot: () => string, iteration: number): void;
  /**
   * Durable tool-effect seam (GH #262) - record a side-effecting tool call
   * BEFORE it executes. Awaited by design: the pre-effect `executing` row must
   * be committed before the world can change, or the record is worth nothing.
   * Present only when durable runs are enabled (`.withDurableRuns()`); absent
   * otherwise, so non-durable runs pay zero cost. Must not throw; persistence failures surface via swallowed-error emission in the implementation.
   */
  onToolEffectStart?(spec: ToolEffectSpec): Promise<void>;
  /**
   * Durable tool-effect seam (GH #262) - record the outcome of a tool call
   * AFTER it completed (success or failure). Awaited so a crash can never
   * fall between "effect happened" and "outcome durable" except inside the
   * tool call itself. Must not throw.
   */
  onToolEffectEnd?(spec: ToolEffectSpec, outcome: ToolEffectOutcome): Promise<void>;
}

/**
 * Stable identity of one side-effecting tool call (GH #262). `effectId` is
 * framework-minted at dispatch (`fx-<taskId>-<iteration>-<index>`), NOT the
 * provider call id: a crash-resume re-derivation re-mints provider ids, so the
 * durable record must never key on them. `toolCallId` is carried for
 * provenance (what the ledger used) only.
 */
export interface ToolEffectSpec {
  readonly effectId: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** Canonical (key-sorted) JSON of the tool arguments (half of the recovery identity). */
  readonly argsJson: string;
}

/** Terminal outcome of one recorded tool effect (GH #262). */
export type ToolEffectOutcome =
  | {
      readonly status: "succeeded";
      /** Full tool-result content (capped by the writer) so a resumed run can inject it without re-executing. */
      readonly resultContent: string;
    }
  | {
      readonly status: "failed";
      readonly errorText: string;
    };

/**
 * Durable record of one tool effect as persisted by the RunStore (GH #262).
 * Status "executing" means the pre-effect write committed but no terminal
 * write did: the AMBIGUOUS crash-window case (effect may or may not have
 * happened). Resume reconciliation consumes this status.
 */
export interface ToolEffectRecord {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly argsJson: string;
  readonly status: "executing" | "succeeded" | "failed";
  readonly resultContent?: string;
  readonly errorText?: string;
  readonly effectId: string;
}

/**
 * Recovery identity for a tool effect: tool name + canonical args JSON. The
 * resume path re-derives calls (provider call ids are re-minted), so effects
 * bind to WHAT was called, not what id the provider gave it.
 */
export const toolEffectIdentityKey = (
  toolName: string,
  argsJson: string,
): string => `${toolName}\x00${argsJson}`;

/**
 * Canonical JSON key-sorted stringify; stable across insertion order so the
 * effect identity of {a:1,b:2} equals that of {b:2,a:1}. Arrays keep order
 * (positions are semantic); primitives stringify like JSON.stringify.
 */
export const canonicalToolArgsJson = (args: unknown): string => {
  const w: (value: unknown) => unknown = (value) => {
    if (Array.isArray(value)) return value.map(w);
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, w(v)]);
      return Object.fromEntries(entries);
    }
    return value;
  };
  return JSON.stringify(w(args)) ?? String(args);
};

/**
 * A human's approval decision for a paused durable run, carried into a resumed
 * run by `ReactiveAgent.approveRun`/`denyRun` (run slot `approvalDecisionSlot`).
 * The reasoning THINK phase forwards it as `KernelInput.approvalDecision`,
 * where the runner applies it at the gate instead of re-thinking. Durable HITL
 * (Phase D).
 */
export interface ApprovalDecision {
  readonly gateId: string;
  readonly status: "approved" | "denied";
  readonly reason?: string;
}

/** One selectable option of a choice {@link InteractionQuestion}. */
export interface InteractionQuestionOption {
  /** Text shown to the human. */
  readonly label: string;
  /** Value reported back in the answer when this option is picked. */
  readonly value: string;
  /** Optional extra explanation shown under the label. Absent when the label is enough. */
  readonly description?: string;
}

/**
 * One question of a structured `request_user_input` interaction. Structural
 * mirror of the `Question` type in `@reactive-agents/tools` (core cannot import
 * it); that type must stay assignable to this one. A host answers a structured
 * interaction with an id-keyed map carried in {@link InteractionResponse.valueJson}.
 */
export interface InteractionQuestion {
  /** Unique within the request; the key of this question's answer. */
  readonly id: string;
  /** The question text shown to the human. */
  readonly prompt: string;
  /** The answer type asked for. */
  readonly type: "text" | "single-choice" | "multi-choice" | "boolean" | "number";
  /** Selectable options. Present for `single-choice` / `multi-choice`; absent otherwise. */
  readonly options?: readonly InteractionQuestionOption[];
  /** Whether an answer is required. Absent means required (true). */
  readonly required?: boolean;
  /** Value used when a non-required question is skipped. Absent means no default. */
  readonly default?: unknown;
  /** `number`: inclusive lower bound. `multi-choice`: fewest options to pick. */
  readonly min?: number;
  /** `number`: inclusive upper bound. `multi-choice`: most options to pick. */
  readonly max?: number;
  /** `text`: longest accepted answer. */
  readonly maxLength?: number;
  /** Choice questions: also accept a free-text value outside `options`. */
  readonly allowOther?: boolean;
}

/**
 * A human's response to a paused durable `request_user_input` interaction,
 * carried into a resumed run by `ReactiveAgent.respondToInteraction` (run slot
 * `interactionResponseSlot`). The reasoning THINK phase forwards it as
 * `KernelInput.interactionResponse`. Agentic-UI durable interaction rail
 * (Task 10).
 */
export interface InteractionResponse {
  readonly interactionId: string;
  /**
   * JSON-serialized user value (JSON.stringify of whatever the human answered).
   * For a structured interaction (questions present) this is an id-keyed map of
   * answers, one entry per {@link InteractionQuestion.id}.
   */
  readonly valueJson: string;
}
