import { parsePartialObject } from "../parse-partial.js";
import type {
  PendingInteractionWire,
  SeqStamped,
  UiRunStatus,
  UiStreamEvent,
} from "../protocol/events.js";

export interface RunState {
  readonly status: UiRunStatus;
  readonly runId?: string;
  readonly text: string;
  readonly output?: string;
  readonly object?: unknown;
  readonly events: readonly SeqStamped<UiStreamEvent>[];
  readonly pendingInteraction?: PendingInteractionWire;
  readonly pendingApproval?: {
    readonly runId: string;
    readonly gateId: string;
    readonly toolName: string;
    readonly args: unknown;
  };
  readonly abstention?: { readonly reason: string; readonly missing?: readonly string[] };
  readonly cost?: { readonly tokens: number; readonly usd: number };
  readonly error?: string;
  readonly lastSeq?: number;
}

export const initialRunState = (): RunState => ({
  status: "idle",
  text: "",
  events: [],
});

export interface ReduceOptions {
  readonly objectMode?: boolean;
}

export const reduceRunState = (
  state: RunState,
  event: SeqStamped<UiStreamEvent>,
  opts: ReduceOptions = {},
): RunState => {
  const base: RunState = {
    ...state,
    events: [...state.events, event],
    lastSeq: event.seq ?? state.lastSeq,
  };

  switch (event._tag) {
    case "TextDelta": {
      const text = base.text + event.text;
      const object = opts.objectMode ? parsePartialObject(text) ?? base.object : base.object;
      return { ...base, status: "streaming", text, object };
    }
    case "RunAttached":
      return { ...base, runId: event.runId, status: statusFromRun(event.status) };
    case "InteractionRequested": {
      const { _tag: _drop, ...pending } = event;
      return { ...base, runId: event.runId, pendingInteraction: pending };
    }
    case "ApprovalRequested":
      return {
        ...base,
        runId: event.runId,
        pendingApproval: {
          runId: event.runId,
          gateId: event.gateId,
          toolName: event.toolName,
          args: event.args,
        },
      };
    case "RunPaused":
      return { ...base, status: event.reason };
    case "Abstained":
      return { ...base, abstention: { reason: event.reason, missing: event.missing } };
    case "CostDelta":
      return { ...base, cost: { tokens: event.tokens, usd: event.usd } };
    case "StreamCompleted": {
      const meta = event.metadata;
      const cost =
        typeof meta.tokensUsed === "number" || typeof meta.cost === "number"
          ? { tokens: meta.tokensUsed ?? 0, usd: meta.cost ?? 0 }
          : base.cost;
      // A completion that carries a pending gate is a pause, not a finish.
      if (event.pendingInteraction !== undefined) {
        return {
          ...base,
          runId: event.runId ?? base.runId,
          pendingInteraction: event.pendingInteraction,
          status: "awaiting-interaction",
          cost,
        };
      }
      if (event.pendingApproval !== undefined) {
        return {
          ...base,
          runId: event.runId ?? base.runId,
          pendingApproval: event.pendingApproval,
          status: "awaiting-approval",
          cost,
        };
      }
      return {
        ...base,
        status: "completed",
        runId: event.runId ?? base.runId,
        output: event.output,
        abstention: event.abstention ?? base.abstention,
        cost,
      };
    }
    case "StreamError":
      return { ...base, status: "error", error: event.cause };
    case "StreamCancelled":
      return { ...base, status: "cancelled" };
    case "LimitExceeded":
      return { ...base, status: "error", error: `limit exceeded: ${event.kind}` };
    default:
      // Progress/observability tags (IterationProgress, ToolCall*, Thought*,
      // Phase*, reserved tags) accumulate in events[] without a state change.
      return base.status === "idle" ? { ...base, status: "streaming" } : base;
  }
};

const statusFromRun = (runStatus: string): UiRunStatus => {
  switch (runStatus) {
    case "awaiting-interaction":
      return "awaiting-interaction";
    case "awaiting-approval":
      return "awaiting-approval";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    default:
      return "streaming";
  }
};
