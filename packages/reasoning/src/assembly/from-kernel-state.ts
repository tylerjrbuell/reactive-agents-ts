/**
 * from-kernel-state.ts — Adapter: KernelState → AssemblyInput
 *
 * Translates a live (or snapshot) KernelState into the pure AssemblyInput
 * shape consumed by `project()`. This is intentionally a pure function: it
 * reads from state but never mutates it. Phase 3 will route the live path
 * through project() via this adapter.
 */
import type { KernelState } from "../kernel/state/kernel-state.js";
import type { ContextProfile } from "../context/context-profile.js";
import { EventLog } from "./event-log.js";
import { ResultStore } from "./result-store.js";
import { resolveCapability, type Tier } from "./capability.js";
import type { AssemblyInput } from "./project.js";

// ── fromKernelState ───────────────────────────────────────────────────────────

/**
 * Build an `AssemblyInput` from a live `KernelState`.
 *
 * Mapping:
 * - `store`  : all scratchpad entries are seeded via `putWithRef` to preserve
 *              `_tool_result_N` identity; value is JSON-parsed (fallback: raw).
 * - `log`    : goal from first user message → tool_called per assistant toolCall
 *              → tool_result per tool_result message.
 * - `capability`: resolved from the supplied ContextProfile.
 *
 * @param state   Immutable KernelState (not mutated).
 * @param profile ContextProfile for the current run (tier, maxTokens, …).
 * @param persona System-prompt persona injected into AssemblyInput.
 * @param tools   Tool schemas for this run.
 */
export function fromKernelState(
  state: KernelState,
  profile: ContextProfile,
  persona: { system: string },
  tools: { schemas: readonly unknown[] },
  /**
   * Canonical task text (KernelInput.task). Used as the goal fallback when the
   * conversation thread has not been seeded with a user turn — `state.messages`
   * is seeded ONLY from `initialMessages` (runner.ts:204), so a strategy invoked
   * without seeding (e.g. `executeReactive({...})` with no `initialMessages`)
   * leaves `state.messages` empty. Legacy `curate()` always sourced the prompt
   * from `input.task` regardless of seeding; project() must do the same or the
   * task is silently dropped (no goal in the system prompt, empty messages[] →
   * provider rejects a zero-user-turn request). `input.task` is required + always
   * present, unlike the conditional `state.meta.taskDescription`.
   */
  task?: string,
  /**
   * H1: carried prior context (KernelInput.priorContext) — switch handoffs,
   * ToT approach summaries, reflexion hints, memory bootstrap. Threaded to
   * AssemblyInput so systemPromptStage can render it (audit 03-F1).
   */
  priorContext?: string,
): AssemblyInput {
  // ── 1. Seed ResultStore from scratchpad ──────────────────────────────────
  //
  // Build a storedKey→toolName lookup from tool_result messages first so the
  // store entries carry a useful tool name instead of the generic "tool" fallback.
  const storedKeyToTool = new Map<string, string>();
  for (const msg of state.messages) {
    if (msg.role === "tool_result" && msg.storedKey) {
      storedKeyToTool.set(msg.storedKey, msg.toolName);
    }
  }

  const store = new ResultStore();
  for (const [storedKey, jsonStr] of state.scratchpad) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = jsonStr;
    }
    const toolName = storedKeyToTool.get(storedKey) ?? "tool";
    store.putWithRef(storedKey, toolName, parsed);
  }

  // ── 1b. Read `preserveOnCompaction` off observation steps (C4, audit 03-F4) ──
  //
  // The flag is SET by makeObservationResult (preserve when !success ||
  // category==="error") but was READ BY NOTHING. Build a toolCallId→preserve map
  // from the observation steps so it can ride the EventLog `tool_result` event
  // into the compaction path (which now honors it). Observation steps link back
  // to their originating tool call via `metadata.toolCallId`.
  const preserveByCallId = new Map<string, boolean>();
  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const callId = step.metadata?.toolCallId;
    const preserve = step.metadata?.observationResult?.preserveOnCompaction;
    if (typeof callId === "string" && preserve === true) {
      preserveByCallId.set(callId, true);
    }
  }

  // ── 2. Build EventLog ────────────────────────────────────────────────────
  //
  // The goal text lives in the first user message (the kernel seeds messages
  // with [{role:"user", content: task}] — see CLAUDE.md FC thread flow).
  let log = new EventLog();

  const firstUser = state.messages.find((m) => m.role === "user");
  const goalText =
    firstUser && firstUser.role === "user" ? firstUser.content : task;
  if (goalText) {
    log = log.append({ kind: "goal", text: goalText });
  }

  for (const msg of state.messages) {
    if (msg.role === "assistant") {
      for (const tc of msg.toolCalls ?? []) {
        // ToolCallSpec.arguments is Record<string,unknown> by convention; use
        // a guard so we never cast to any.
        const args: Record<string, unknown> =
          tc.arguments !== null &&
          typeof tc.arguments === "object" &&
          !Array.isArray(tc.arguments)
            ? (tc.arguments as Record<string, unknown>)
            : {};
        log = log.append({
          kind: "tool_called",
          tool: tc.name,
          callId: tc.id,
          args,
        });
      }
    } else if (msg.role === "tool_result") {
      // Determine the ref: prefer storedKey (already in store); otherwise
      // mint a new content-hash ref via put() so every result is reachable.
      let ref: string;
      if (msg.storedKey) {
        ref = msg.storedKey;
      } else {
        // Small inline result — content not in scratchpad; store it now.
        ref = store.put(msg.toolName, msg.content);
      }
      log = log.append({
        kind: "tool_result",
        callId: msg.toolCallId,
        ref,
        shape: "result",
        ...(preserveByCallId.get(msg.toolCallId) === true ? { preserve: true } : {}),
      });
    }
  }

  // ── 3. Resolve capability ────────────────────────────────────────────────
  const capability = resolveCapability({
    window: profile.maxTokens ?? 32_768,
    outputBudget: 2000,
    dialect: "native-fc",
    tier: (profile.tier as Tier) ?? "mid",
  });

  // Augment tools with the dispatcher's requiredTools + the profile's schema-detail
  // so the in-prompt tool reference (systemPromptStage) can render the tier-adaptive
  // "Required tools (call these)" grouping for weak-FC local models. Both are read
  // from state/profile here — no caller (think.ts) change needed.
  const toolsWithPolicy = {
    ...tools,
    ...(state.meta.requiredTools ? { requiredTools: state.meta.requiredTools } : {}),
    ...((profile as { toolSchemaDetail?: "names-only" | "names-and-types" | "full" }).toolSchemaDetail
      ? { detail: (profile as { toolSchemaDetail?: "names-only" | "names-and-types" | "full" }).toolSchemaDetail }
      : {}),
  };
  // Thread the run's custom environmentContext (date overrides + caller fields) onto
  // the persona so systemPromptStage's Environment block reproduces them — state-read,
  // no think.ts change. (state.environmentContext is set from input by react-kernel.)
  const personaWithEnv = state.environmentContext
    ? { ...persona, environmentContext: state.environmentContext }
    : persona;
  // ── D1 (Projector): thread the upstream DAG nodes off state ────────────────
  // The projector RENDERS from (contract, ledger, assessment) — read here (never
  // mutated). `longHorizon` is the opt-in profile gate. All optional → absent
  // (no contract/ledger/assessment/profile) reproduces pre-D1 output byte-for-byte.
  const dagInputs = {
    ...(state.meta.runContract ? { contract: state.meta.runContract } : {}),
    ...(state.ledger && state.ledger.length > 0 ? { ledger: state.ledger } : {}),
    ...(state.meta.assessment ? { assessment: state.meta.assessment } : {}),
    ...(state.meta.horizonProfile === "long" ? { longHorizon: true } : {}),
  };

  return {
    log,
    capability,
    store,
    persona: personaWithEnv,
    tools: toolsWithPolicy,
    ...(priorContext?.trim() ? { priorContext } : {}),
    ...dagInputs,
  };
}
