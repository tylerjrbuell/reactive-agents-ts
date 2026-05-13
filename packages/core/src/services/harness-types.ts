/**
 * Harness API type system — Wave A.
 *
 * All types live here so they can be imported by both @reactive-agents/core
 * (HarnessPipeline) and @reactive-agents/reasoning (KernelInput.harnessPipeline)
 * without circular dependencies.
 */
import type { KernelStateLike } from "./entropy-sensor-tag.js";

// ── Phase enum ────────────────────────────────────────────────────────────────

export type Phase =
  | 'bootstrap'
  | 'guardrail'
  | 'cost-route'
  | 'strategy-select'
  | 'think'
  | 'act'
  | 'observe'
  | 'verify'
  | 'memory-flush'
  | 'cost-track'
  | 'audit'
  | 'complete';

// ── Tag catalog ───────────────────────────────────────────────────────────────

/** All valid harness emission tags (Wave A: 7 initial tags). */
export type Tag =
  | 'prompt.system'
  | 'nudge.loop-detected'
  | 'nudge.healing-failure'
  | 'message.tool-result'
  | 'observation.tool-result'
  | 'lifecycle.failure'
  | 'control.strategy-evaluated';

// ── Context types ─────────────────────────────────────────────────────────────

export type BaseCtx = {
  readonly iteration: number;
  readonly phase: Phase;
  readonly state: Readonly<KernelStateLike>;
  readonly strategy: string;
};

export type NudgeCtx = BaseCtx & {
  readonly trigger: string;
  readonly severity: 'info' | 'warn' | 'critical';
};

export type ToolResultCtx = BaseCtx & {
  readonly toolName: string;
  readonly callId: string;
  readonly healed: boolean;
  readonly durationMs: number;
};

// ── Payload types ─────────────────────────────────────────────────────────────

/** Payload carried by the KernelMessage tag. Structural match — avoids importing from reasoning. */
export type KernelMessageLike =
  | { readonly role: 'assistant'; readonly content: string; readonly toolCalls?: readonly unknown[] }
  | { readonly role: 'tool_result'; readonly toolCallId: string; readonly toolName: string; readonly content: string; readonly isError?: boolean }
  | { readonly role: 'user'; readonly content: string };

/** Payload carried by the observation.tool-result tag. Structural match. */
export type ObservationStepLike = {
  readonly type: string;
  readonly content?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type LifecycleFailurePayload = {
  readonly reason: 'tool-error' | 'llm-refusal' | 'verifier-rejection';
  readonly errorMessage: string;
  readonly attemptNumber: number;
  readonly failureStreak: number;
  readonly currentStrategy: string;
};

export type ControlStrategyEvaluatedPayload = {
  readonly currentStrategy: string;
  readonly score: number;
  readonly failureStreak: number;
  readonly recommendedAction: 'continue' | 'switch' | 'escalate';
  readonly availableStrategies: readonly string[];
};

// ── TagMap — canonical payload+context per tag ────────────────────────────────

export interface TagMap {
  'prompt.system':              { payload: string;                        ctx: BaseCtx };
  'nudge.loop-detected':        { payload: string;                        ctx: NudgeCtx };
  'nudge.healing-failure':      { payload: string;                        ctx: NudgeCtx };
  'message.tool-result':        { payload: KernelMessageLike;             ctx: ToolResultCtx };
  'observation.tool-result':    { payload: ObservationStepLike;           ctx: ToolResultCtx };
  'lifecycle.failure':          { payload: LifecycleFailurePayload;       ctx: BaseCtx };
  'control.strategy-evaluated': { payload: ControlStrategyEvaluatedPayload; ctx: BaseCtx };
}

// ── Derived helper types ───────────────────────────────────────────────────────

export type PayloadFor<T extends Tag> = TagMap[T]['payload'];
export type ContextFor<T extends Tag> = TagMap[T]['ctx'];

// ── Pattern types ─────────────────────────────────────────────────────────────

/**
 * A TagPattern is one of:
 * - An exact tag string (e.g. 'prompt.system')
 * - A single-wildcard pattern (e.g. 'prompt.*')
 * - A multi-segment wildcard (e.g. 'prompt.**')
 * - A catch-all (e.g. '**')
 * - A predicate function for power-user use
 */
export type TagPattern =
  | Tag
  | `${string}.*`
  | `${string}.**`
  | '**'
  | ((tag: Tag) => boolean);

// ── Transform / Tap function types ────────────────────────────────────────────

export type TransformFn<T extends Tag> = (
  payload: PayloadFor<T>,
  ctx: ContextFor<T>,
) =>
  | PayloadFor<T>
  | undefined
  | null
  | Promise<PayloadFor<T> | undefined | null>;

export type TapFn<T extends Tag> = (
  payload: PayloadFor<T>,
  ctx: ContextFor<T>,
) => void | Promise<void>;

/**
 * Resolves the payload type for a pattern.
 * For exact tags → the precise payload; for wildcards → the union of all matching payloads.
 */
export type TransformFor<P extends TagPattern> =
  P extends Tag
    ? TransformFn<P>
    : TransformFn<Tag>;

export type TapFor<P extends TagPattern> =
  P extends Tag
    ? TapFn<P>
    : TapFn<Tag>;

// ── Lifecycle hook types ───────────────────────────────────────────────────────

export type PhaseHookFn<_Ph extends Phase> = (ctx: { readonly phase: _Ph; readonly iteration: number; readonly state: Readonly<KernelStateLike> }) =>
  | void
  | Promise<void>
  | { readonly skip: true }
  | { readonly abort: 'stop' | 'terminate'; readonly reason?: string };

export type ErrorHookFn<_Ph extends Phase | '*'> = (
  error: unknown,
  ctx: { readonly phase: _Ph; readonly iteration: number },
) => void | Promise<void> | { readonly recover: Readonly<KernelStateLike> };

// ── Registration shape ────────────────────────────────────────────────────────

export type Registration =
  | { readonly kind: 'transform'; readonly pattern: TagPattern; readonly fn: TransformFn<Tag> }
  | { readonly kind: 'tap';       readonly pattern: TagPattern; readonly fn: TapFn<Tag> }
  | { readonly kind: 'before';    readonly phase: Phase;        readonly fn: PhaseHookFn<Phase> }
  | { readonly kind: 'after';     readonly phase: Phase;        readonly fn: PhaseHookFn<Phase> }
  | { readonly kind: 'onError';   readonly phase: Phase | '*';  readonly fn: ErrorHookFn<Phase | '*'> }
  | { readonly kind: 'inject';    readonly tag: Tag;            readonly payload: unknown }
  | { readonly kind: 'use';       readonly sub: readonly Registration[] };
