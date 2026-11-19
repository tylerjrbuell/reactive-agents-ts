import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { gatewayComplete } from "@reactive-agents/reasoning";
import type { AgentEvent, EnvironmentChangedEvent, Plan, PlanFinding, RunOrigin, RunPosture } from "@reactive-agents/core";
import { editPlan, findingsAfterEdit, freshPlanMeta, planOfTodo, type SessionPlanMeta } from "./chat/session-plan.js";
import type { PlanStepInput } from "./agent/plan-facade.js";
import type { EnvironmentSnapshotInput } from "./chat/environment-snapshot.js";
import type { AgentDebrief } from "./debrief.js";
import type { AgentResult } from "./builder/types.js";
import {
  applyHistoryWindowWithOverflow,
  type HistoryOverflowHandler,
} from "./gateway-context-formatting.js";
export type { HistoryOverflowHandler } from "./gateway-context-formatting.js";
import type { RunHandle } from "./run-controller.js";
import { ChatEngine } from "./chat/engine.js";
import { DEFAULT_CHAT_MODE, type ChatMode } from "./chat/session-mode.js";
export type { ChatMode } from "./chat/session-mode.js";
import { taskInputText, type TaskInput } from "./agent/task-input.js";
import { ChatEngineCapabilityError } from "./chat/engine-errors.js";
import type { StreamDensity } from "./stream-types.js";
import { originCarry, planPosture, type TodoSeedItem } from "./chat/todo-seed.js";
import { workspaceCarry, type WorkspaceOption } from "./engine/start-run.js";
import { skillsOption, type SkillsRunOption } from "./runtime-skills-layer.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * A single message in a chat session history.
 *
 * Used internally by `AgentSession` to maintain conversation context
 * and by `agent.chat()` for multi-turn interactions.
 */
export interface ChatMessage {
  /** Who sent this message: "user" for caller input, "assistant" for agent replies */
  role: "user" | "assistant";
  /** Message content */
  content: string;
  /** Unix timestamp in milliseconds when the message was added */
  timestamp: number;
  /**
   * `true` on an assistant row recording a run that FAILED (`success: false`,
   * not paused). Its `content` is then the failure note
   * `[previous run failed: <cause>; no answer was given]`, never the failed
   * run's output, so the next turn's history tells the model no answer was
   * given. Render it as a failed turn, not as an agent reply. Absent on
   * normal rows.
   */
  failed?: boolean;
  /** The failure cause (`AgentResult.error`), present only when `failed` is `true`. */
  error?: string;
  /** The durable run id behind a failed tool turn; the handle for `agent.resumeRun(runId)`. */
  runId?: string;
  /** `true` on a failed row whose run a loop guard stopped and `resumeRun(runId)` can continue (the host's Continue action). */
  resumable?: boolean;
}

/**
 * Response returned by `agent.chat()` or `session.chat()`.
 *
 * Contains the agent's reply text plus optional metadata about how
 * the response was produced (tools used, token count, cost).
 */
export interface ChatReply {
  /** The agent's response text */
  message: string;
  /** Names of tools called during response generation (tool-capable path only) */
  toolsUsed?: string[];
  /** Whether the response was served from prior memory or debrief context */
  fromMemory?: boolean;
  /** Token count from the LLM response (when available) */
  tokens?: number;
  /**
   * Provider-reported prompt (input) tokens, when the provider split the
   * count. Absent means "not reported"; never fabricated from `tokens`.
   */
  inputTokens?: number;
  /** Provider-reported completion (output) tokens; absent means "not reported". */
  outputTokens?: number;
  /** Reasoning steps taken (tool-capable path only) */
  steps?: number;
  /**
   * Cost in USD. Direct path: absent when the model's price is unknown (not
   * free) or no usage was reported. Tool path: the run meter's total, a lower
   * bound when {@link costComplete} is `false`.
   */
  cost?: number;
  /**
   * `false` when at least one LLM call in this reply had no known price, so
   * `cost` (when present) understates the spend. Absent means every call was
   * priced. Same source as `AgentResultMetadata.costComplete`.
   */
  costComplete?: boolean;
  /**
   * Full reasoning-step evidence (tool-capable path only). Structurally
   * typed to mirror `@reactive-agents/reasoning`'s `ReasoningStep` without a
   * cross-package import (same pattern as `TaskResult.metadata.reasoningSteps`
   * in runtime/src/types.ts). Pass this to `validateCitations(message, steps)`
   * (from `@reactive-agents/reasoning`) to deterministically check that every
   * URL the reply cites appears in the run's actual tool-observation evidence.
   */
  reasoningSteps?: readonly {
    id?: string;
    type: string;
    content: string;
    metadata?: Record<string, unknown>;
  }[];
  /**
   * Full (uncompressed) tool-result store, keyed by `ReasoningStep.metadata.storedKey`.
   * Pass this to `validateCitations(message, steps, new Map(Object.entries(scratchpad)))`
   * so it reads the same evidence corpus the kernel's own grounding checks use, not the
   * lossy compressed preview in `reasoningSteps[].content`.
   */
  scratchpad?: Readonly<Record<string, string>>;
  /**
   * Result of `validateCitations()` against tool-observation evidence — only
   * populated when `ChatOptions.verifyCitations` is true AND the reply was
   * produced on the tool-capable path (there is no tool evidence to check
   * citations against on the direct-LLM path, so the field is omitted there
   * rather than reporting a false `ok: true`).
   */
  citationCheck?: {
    ok: boolean;
    uncitedUrls: readonly string[];
    citedUrlCount: number;
  };
  /**
   * Tool-capable path only: the run's `AgentResult.goalAchieved` (the exit
   * gate's verdict; `false` = the gate denied completion, `null` = ambiguous).
   */
  goalAchieved?: boolean | null;
  /** Tool-capable path only: RunContract requirement ids still outstanding at the run's end (`metadata.outstandingCriteria`). */
  outstandingCriteria?: readonly string[];
  /** Tool-capable path only: the run's `AgentResult.evidenceDelta` (summed new evidence; `0` = none). */
  evidenceDelta?: number;
  /**
   * Tool-capable path only: the run's `AgentResult.status`. A durable run that
   * paused is `"awaiting-approval"` / `"awaiting-interaction"`; `message` is
   * then not a final answer. Absent on a normal run.
   */
  status?: AgentResult["status"];
  /** Tool-capable path only: present when `status === "awaiting-approval"`. The paused gate and the durable runId to approve/deny. */
  pendingApproval?: AgentResult["pendingApproval"];
  /** Tool-capable path only: present when `status === "awaiting-interaction"`. The paused interaction and the durable runId to respond to. */
  pendingInteraction?: AgentResult["pendingInteraction"];
  /**
   * Tool-capable path only: `true` when the run failed (`AgentResult.success`
   * false, not paused). `message` is then the failed run's output (its last
   * narration or draft), not an answer; the session history records the turn
   * as failed (see `ChatMessage.failed`). Absent on a normal run.
   */
  failed?: boolean;
  /** Tool-capable path only: the failure cause (`AgentResult.error`), present only when `failed` is `true`. */
  error?: string;
  /** Tool-capable path on a `.withDurableRuns()` agent: the durable run id behind this turn (`agent.resumeRun(runId)`). */
  runId?: AgentResult["runId"];
  /** Tool-capable path: set when a loop guard stopped the turn's run (reason, repeated tool, tools done, unfinished). */
  loopStop?: AgentResult["loopStop"];
  /** Tool-capable path: `true` when `agent.resumeRun(runId)` can continue the turn's run (the host's Continue action). */
  resumable?: AgentResult["resumable"];
}

/**
 * Options for `agent.chat()` — override automatic routing behavior.
 *
 * By default, an agent with capability tools takes the tool loop and one
 * without stays on the direct path. Use these options to force a specific path.
 */
export interface ChatOptions extends WorkspaceOption, SkillsRunOption {
  /**
   * Override the tool-loop decision for this call.
   *
   * Precedence: this explicit `useTools` > `.withToolIntent()` on the builder (if any)
   * > the capability default (tool loop iff the agent has capability tools).
   */
  useTools?: boolean;
  /** Maximum iterations for the tool-capable path. Default: 5 */
  maxIterations?: number;
  /** Optional context prepended to the system context summary (direct-LLM path only). */
  extraContext?: string;
  /**
   * Deterministically verify that every URL the reply cites appears in the
   * run's tool-observation evidence (via `validateCitations` from
   * `@reactive-agents/reasoning`). Tool-capable path only — no-op on the
   * direct-LLM path since there is no tool evidence to check against.
   * Default: false (no cost unless opted in).
   */
  verifyCitations?: boolean;
  /**
   * Run posture for this turn. `"plan"` ⇒ the harness runs the turn plan-only
   * (tool surface + guidance derived from the posture, not from prompt text).
   * Absent or `"execute"` ⇒ today's behavior, request bytes identical. Applies to
   * the tool and streaming paths; the direct (no-tools) path has no kernel run, so
   * it is a no-op there.
   */
  posture?: RunPosture;
  /**
   * Caller origin recorded on this turn's `run-started.origin` (tool and
   * streaming paths). Overrides the session's `origin`; absent ⇒ the session's
   * origin, else the engine default (`"user"`). Measurement only.
   */
  origin?: RunOrigin;
}

/**
 * Options for `agent.session()` — configure session lifecycle behavior.
 *
 * The live options are the ones accepted inline by
 * `ReactiveAgent.session()`: `persist` (save/restore history via
 * `SessionStoreService` — requires the memory layer) and `id` (stable
 * session identifier for resuming).
 */
export interface SessionOptions {
  /**
   * The mode the session starts in: `"execute"` (default) or `"plan"` (pure
   * reasoning, no tools). Switch later with `session.setMode()`. Independent
   * of the `plan-execute` reasoning strategy.
   */
  mode?: ChatMode;
  /**
   * Caller origin for every run this session starts (`run-started.origin`),
   * e.g. `"cortex-chat"`. Absent ⇒ `"user"`. A per-turn `ChatOptions.origin` wins.
   */
  origin?: RunOrigin;
  /**
   * Persist conversation history to the SQLite session store (requires the
   * memory layer). Default: agent-level `_sessionPersist` (false unless opted in).
   */
  persist?: boolean;
  /**
   * Stable session identifier for resuming a prior conversation. When omitted
   * the engine generates a canonical `sess_session_<unique>` id.
   */
  id?: string;
  /** Retention window in days for persisted sessions (host-defined). */
  maxAgeDays?: number;
  /**
   * Called when history windowing would drop turns for this session's `chat()`
   * calls, with exactly the dropped turns (oldest-to-newest). Its returned
   * summary text is spliced back in as a synthetic leading turn.
   */
  onOverflow?: HistoryOverflowHandler;
  /**
   * Pre-seed the session with an existing conversation (oldest first, symmetric
   * user/assistant turns) instead of restoring from the framework session
   * store. Intended for hosts that own their own persistence: seed each
   * rebuilt engine from the host's store.
   *
   * Precedence ruling: a NON-EMPTY `initialHistory` takes precedence over the
   * `SessionStoreService` loader — the loader is NEVER called (the engine's
   * load-once latch is marked satisfied at construction), and this applies
   * even with `persist: true`. An EMPTY array does NOT latch: persistence
   * loading still resolves on the first turn exactly as when the option is
   * omitted.
   */
  initialHistory?: ChatMessage[];
  /**
   * The conversation's persisted to-do list (see `snapshotToTodoSeed`). Every
   * streamed turn starts from the latest list, so the model's `todo` tool
   * continues it instead of starting empty; read it back with `session.todo()`.
   */
  initialTodo?: readonly TodoSeedItem[];
  /** The conversation's stored plan findings (recon facts), seeded with `initialTodo` so `session.plan.findings` and the next Execute turn carry them after a rebuild. Malformed rows are dropped. */
  initialPlanFindings?: readonly PlanFinding[];
  /**
   * Live environment facts (model, tools, skills, docs, goal...) read at each turn
   * boundary. When supplied, a change between two turns publishes one
   * `EnvironmentChanged` event and tells the model what changed. Absent ⇒ no
   * environment updates (request bytes identical).
   */
  environment?: () => EnvironmentSnapshotInput;
  /**
   * Where `EnvironmentChanged` is published. Default when `environment` is supplied:
   * the agent's runtime EventBus (so trace bridges pick it up).
   */
  publishEnvironment?: (event: EnvironmentChangedEvent) => Promise<void>;
  /**
   * Environment the previous (dropped/evicted/rebuilt) session last saw. The first
   * turn diffs against it, so a config/tool/to-do change made between rebuilds is
   * still reported. Absent ⇒ the first turn only records a baseline (no notice).
   */
  initialEnvironment?: EnvironmentSnapshotInput;
  /** Tell the model what changed since its last turn (needs `environment`). Default true; `false` opts out. */
  environmentUpdates?: boolean;
}

// ─── Intent classifier (heuristic, zero tokens) ────────────────────────────

/**
 * Heuristic intent classifier — returns true when the message NEEDS tools
 * to answer (e.g. "search for X", "send a message to Y").
 *
 * Returns false for conversational / reflective messages even if they contain
 * tool-adjacent words like "found", "sent", "created" — these refer to past
 * actions, not new tool invocations.
 *
 * Priority: false positives (routing to tool path unnecessarily) are worse
 * than false negatives (missing a tool need) because the tool path loses
 * chat context. When in doubt, route to direct LLM.
 */
const TOOL_INTENT_PATTERNS = [
  // Active imperatives — user wants the agent to DO something now
  /\b(search for|fetch|look up|what is the current|what are the latest)\b/i,
  /\b(write to|create a|save to|send a|post to|update the|delete the)\b/i,
  /\b(run this|execute this|calculate|compute)\b/i,
];

// Conversational patterns that override tool intent — past tense, reflective
const CHAT_OVERRIDE_PATTERNS = [
  /\b(what did you|tell me about|which one|summarize|explain|describe|how did)\b/i,
  /\b(in the last run|earlier|previous|before)\b/i,
];

/**
 * @deprecated Not the default routing any more: `chat()` takes the tool loop when the
 * agent has capability tools, whatever the wording. This wording heuristic is kept
 * for compatibility and as the opt-in `.withToolIntent("message")`.
 */
export function requiresTools(message: string): boolean {
  // Conversational overrides take priority — these are about past actions, not new ones
  if (CHAT_OVERRIDE_PATTERNS.some((p) => p.test(message))) return false;
  return TOOL_INTENT_PATTERNS.some((p) => p.test(message));
}

// ─── Context builder from debrief ─────────────────────────────────────────

export function buildContextSummary(
  lastDebrief?: AgentDebrief,
  observations?: readonly string[],
): string {
  const hasObservations = observations !== undefined && observations.length > 0;
  if (!lastDebrief && !hasObservations) return "";
  const parts: string[] = [];
  if (lastDebrief) {
    parts.push(
      `## Last Run Results`,
      `Outcome: ${lastDebrief.outcome} (confidence: ${lastDebrief.confidence})`,
      `Summary: ${lastDebrief.summary}`,
    );
    if (lastDebrief.keyFindings.length > 0) {
      parts.push(`Key findings:\n${lastDebrief.keyFindings.map((f) => `- ${f}`).join("\n")}`);
    }
    if (lastDebrief.toolsUsed.length > 0) {
      parts.push(`Tools used: ${lastDebrief.toolsUsed.map((t) => `${t.name} (${t.calls}x, ${t.successRate}% success)`).join(", ")}`);
    }
    if (lastDebrief.errorsEncountered.length > 0) {
      parts.push(`Errors: ${lastDebrief.errorsEncountered.join("; ")}`);
    }
    if (lastDebrief.metrics) {
      parts.push(`Metrics: ${lastDebrief.metrics.iterations} iterations, ${lastDebrief.metrics.tokens} tokens, ${(lastDebrief.metrics.duration / 1000).toFixed(1)}s`);
    }
  }

  // Include actual tool results so the chat can reference specific data
  if (hasObservations) {
    // Cap total observation text to ~3000 chars to avoid blowing up context
    let totalChars = 0;
    const included: string[] = [];
    for (const obs of observations) {
      if (totalChars + obs.length > 3000) {
        // Truncate long observations to fit within budget
        const remaining = 3000 - totalChars;
        if (remaining > 100) {
          included.push(obs.slice(0, remaining) + "…");
        }
        break;
      }
      included.push(obs);
      totalChars += obs.length;
    }
    parts.push(`\n## Tool Results (from last run)\n${included.map((o, i) => `### Result ${i + 1}\n${o}`).join("\n\n")}`);
  }

  parts.push(`\nUse this information to answer questions about what you did, found, or accomplished. Reference specific data from tool results when answering.`);
  return parts.join("\n");
}

/**
 * Formats {@link ReactiveAgentBuilder.withTaskContext} data for `agent.chat()` system context.
 * ExecutionEngine injects the same record into the reasoning loop on `run()`; chat must merge it
 * explicitly because the direct-LLM path does not boot the full execution pipeline.
 */
export function formatTaskContextForChat(ctx?: Record<string, string> | undefined): string {
  if (!ctx) return "";
  const entries = Object.entries(ctx).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0,
  );
  if (entries.length === 0) return "";
  const body = entries.map(([k, v]) => `### ${k}\n${v.trim()}`).join("\n\n");
  return `## Task / session grounding\n\n${body}`;
}

/**
 * Full conversational context: static task context from build time plus last `.run()` debrief/observations.
 */
export function buildChatSystemContext(
  taskContext?: Record<string, string> | undefined,
  lastDebrief?: AgentDebrief,
  observations?: readonly string[],
): string {
  const taskBlock = formatTaskContextForChat(taskContext);
  const runBlock = buildContextSummary(lastDebrief, observations);
  return [taskBlock, runBlock].filter(Boolean).join("\n\n---\n\n");
}

// ─── Direct LLM chat (no tools) ────────────────────────────────────────────



// ─── AgentSession ──────────────────────────────────────────────────────────

export class AgentSession {
  private readonly engine?: ChatEngine;

  // Legacy (pre-engine) backing state — retained for callers that construct
  // `AgentSession` directly with a `chatFn` (cortex, older tests). New
  // `agent.session()` instances are engine-backed and use `this.engine`.
  private _history: ChatMessage[] = [];
  private _historyLoader?: () => Promise<ChatMessage[]>;
  private _historyLoaded = false;
  private _mode: ChatMode = DEFAULT_CHAT_MODE;
  private readonly chatFn?: (message: string, history: ChatMessage[], options?: ChatOptions) => Promise<ChatReply>;
  private readonly onEnd?: (history: ChatMessage[]) => Promise<void>;
  private readonly onSave?: (history: ChatMessage[]) => Promise<void>;
  private readonly onOverflow?: HistoryOverflowHandler;

  constructor(
    engineOrChatFn:
      | ChatEngine
      | ((message: string, history: ChatMessage[], options?: ChatOptions) => Promise<ChatReply>),
    onEnd?: (history: ChatMessage[]) => Promise<void>,
    onSave?: (history: ChatMessage[]) => Promise<void>,
    initialHistory?: ChatMessage[],
    historyLoader?: () => Promise<ChatMessage[]>,
    onOverflow?: HistoryOverflowHandler,
  ) {
    if (engineOrChatFn instanceof ChatEngine) {
      this.engine = engineOrChatFn;
      return;
    }    this.chatFn = engineOrChatFn;
    this.onEnd = onEnd;
    this.onSave = onSave;
    if (initialHistory) this._history = [...initialHistory];
    if (historyLoader) this._historyLoader = historyLoader;
    this.onOverflow = onOverflow;
  }

  /**
   * Send a conversational message through the session.
   *
   * Engine-backed sessions delegate to the held {@link ChatEngine}; legacy
   * sessions retain the pre-engine windowing + recording behavior.
   */
  async chat(message: TaskInput, options?: ChatOptions): Promise<ChatReply> {
    if (this.engine) {
      return this.engine.turn(message, options);
    }
    if (this._historyLoader && !this._historyLoaded) {
      this._history = await this._historyLoader();
      this._historyLoaded = true;
    }
    const historyForChat = this.onOverflow
      ? await applyHistoryWindowWithOverflow(this._history, this.onOverflow)
      : this._history;
    const text = taskInputText(message);
    const reply = await this.chatFn!(text, historyForChat, this._mode === "plan" && options?.posture === undefined ? { ...options, posture: "plan" } : options);
    this._history.push({ role: "user", content: text, timestamp: Date.now() });
    this._history.push({ role: "assistant", content: reply.message, timestamp: Date.now() });
    if (this.onSave) await this.onSave(this._history);
    return reply;
  }

  /**
   * The session's mode: `"execute"` (default) or `"plan"`. In plan mode every
   * turn runs plan-only (pure reasoning, no tools) and the prose plan stays in
   * history, so the next execute turn sees it. Independent of the `plan-execute`
   * reasoning strategy. A per-turn `posture` option still overrides it.
   */
  get mode(): ChatMode {
    return this.engine ? this.engine.mode() : this._mode;
  }

  /**
   * Switch the session mode. It holds for every later turn until changed again;
   * a turn already in flight keeps the mode it started under.
   */
  setMode(mode: ChatMode): void {
    if (this.engine) this.engine.setMode(mode);
    else this._mode = mode;
  }

  /**
   * Snapshot of the session's full conversation history (oldest first).
   */
  history(): ChatMessage[] {
    if (this.engine) return this.engine.history();
    return [...this._history];
  }

  /**
   * The conversation's latest to-do list: the seed plus every change streamed
   * turns made (needs `density: "full"`, which carries `ChecklistUpdated`).
   * Persist it and pass it back as `initialTodo` to resume the conversation.
   */
  todo(): readonly TodoSeedItem[] {
    return this.engine?.todo() ?? [];
  }

  private _planMeta?: SessionPlanMeta;

  /**
   * The conversation's to-do list as a typed {@link Plan}, or `undefined` while
   * the list is empty. A plan turn's list (the model's `todo` list or the steps
   * the harness derived from its reply) lands here after a streamed turn
   * (`session.runStream`); `source` is `"model"` until {@link setPlan} edits it.
   */
  get plan(): Plan | undefined {
    return planOfTodo(this.todo(), (this._planMeta ??= freshPlanMeta(this.engine?.id ?? "session", Date.now())), this.engine?.carry.findings);
  }

  /**
   * Replace the conversation's plan before switching to execute. Takes a
   * {@link Plan} or plain steps (titles, or `{ title, tool?, status?, id? }`);
   * the next turn, in any mode, seeds from the edited list. Publishes
   * `PlanRecorded` (`source: "user-edited"`). Engine-backed sessions only.
   * @returns the plan as recorded
   */
  setPlan(plan: Plan | readonly PlanStepInput[]): Plan {
    if (!this.engine) throw new ChatEngineCapabilityError({ message: "AgentSession.setPlan() requires an engine-backed session (construct via agent.session()).", capability: "runStreamTask" });
    const findings = findingsAfterEdit(plan, this.engine.carry.findings);
    const edit = editPlan(plan, this._planMeta ?? freshPlanMeta(this.engine.id, Date.now()), Date.now(), findings);
    this._planMeta = edit.meta;
    this.engine.carry.setFindings(findings);
    this.engine.setTodo(edit.seed, edit.event);
    return edit.plan;
  }

  /**
   * Flush persistence (when wired) and clear in-memory state.
   */
  async end(): Promise<void> {
    if (this.engine) {
      await this.engine.end();
      return;
    }
    if (this.onSave) await this.onSave(this._history);
    if (this.onEnd) await this.onEnd(this._history);
    this._history = [];
  }

  /**
   * Stream a conversational turn through the held engine. Engine-backed sessions
   * only (legacy `chatFn` sessions have no streaming capability).
   */
  runStream(
    message: TaskInput,
    options?: { readonly density?: StreamDensity; readonly signal?: AbortSignal; readonly posture?: RunPosture; readonly origin?: RunOrigin } & WorkspaceOption & SkillsRunOption,
  ): RunHandle {
    if (!this.engine) {
      throw new ChatEngineCapabilityError({
        message:
          "AgentSession.runStream() requires an engine-backed session (construct via agent.session()).",
        capability: "runStreamTask",
      });
    }
    return this.engine.streamTurn(message, {
      density: options?.density,
      signal: options?.signal,
      ...planPosture(options?.posture),
      ...originCarry(options?.origin),
      ...workspaceCarry(options?.workspace),
      ...skillsOption(options?.skills),
    });
  }
}

export { ChatEngine } from "./chat/engine.js";
