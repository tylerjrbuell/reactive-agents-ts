/**
 * act/conversation-assembly.ts — Build this turn's conversation-history entry.
 *
 * Extracted from act.ts (WS-6 Phase 5). After `handleActing` has executed the
 * round's tool calls (mutating `allSteps` / `newToolsUsed` in place), this
 * function takes those finalized values as read-only inputs and produces the
 * provider-facing conversation update plus the optional progress / completion
 * guidance message.
 *
 * Pure with respect to caller state: it reads `state`, `allSteps`,
 * `newToolsUsed`, `normalizedPendingCalls`, and the shared scratchpad, and
 * returns a single `ConversationAssembly` record. No mutation, no carrier
 * write-back. `handleActing` decides what to do with the result (hooks,
 * pipeline transform, transitionState).
 *
 * Records produced:
 *   - messages          — provider conversation thread (assistant + tool_result)
 *   - actReminder       — "still must call X" / synthesis nudge (pendingGuidance)
 *   - errorRecovery     — retry-or-finish nudge after a failed round
 *   - completionNudgeSent — whether the once-per-run completion nudge fired
 *
 * NOTE: imports `requirement-state` from the sibling `verify/` capability —
 * a pre-existing one-way edge (act.ts carried it; warn-level baseline). The
 * missing-tools computation is kept co-located with the message-building it
 * drives; routing it out as a param would split the cohesion this extraction
 * exists to capture.
 */
import type { ProviderAdapter } from "@reactive-agents/llm-provider";
import type { ToolCallSpec } from "@reactive-agents/tools";
import type {
  KernelState,
  KernelContext,
  KernelMessage,
} from "../../../kernel/state/kernel-state.js";
import {
  buildSuccessfulToolCallCounts,
  getEffectiveMissingRequiredTools,
} from "../verify/requirement-state.js";
const REQUIRED_TOOLS_SATISFIED_PREFIX = "Required tool calls are satisfied";

/** Observation is a compressed preview that points at scratchpad storage — model must recall before synthesizing. */
function observationReferencesStoredOverflow(content: string): boolean {
  return (
    content.includes("[STORED:") &&
    content.includes("_tool_result_") &&
    (content.includes("full text is stored") ||
      content.includes("full data is stored") ||
      content.includes("full object is stored"))
  );
}

export interface ConversationAssembly {
  readonly messages: readonly KernelMessage[];
  readonly actReminder: string | undefined;
  readonly errorRecovery: string | undefined;
  readonly completionNudgeSent: boolean;
}

/**
 * Build the conversation-history entry + progress/completion guidance for one
 * round of tool calls. See module header for the input/output contract.
 */
export function assembleConversation(args: {
  readonly state: KernelState;
  readonly context: KernelContext;
  readonly adapter: ProviderAdapter;
  readonly allSteps: readonly KernelState["steps"][number][];
  readonly normalizedPendingCalls: readonly ToolCallSpec[];
  readonly newToolsUsed: ReadonlySet<string>;
  readonly sharedScratchpad: ReadonlyMap<string, string>;
}): ConversationAssembly {
  const { state, context, adapter, allSteps, normalizedPendingCalls, newToolsUsed, sharedScratchpad } = args;
  const { input, profile } = context;

  const prior = state.messages as readonly KernelMessage[];

  // Collect action/observation pairs added by this acting phase.
  // Only include steps added after the current state.steps (i.e. this turn).
  const stepsBefore = state.steps.length;
  const newStepsThisTurn = allSteps.slice(stepsBefore);

  // Build the assistant message with tool call specs
  const assistantThought = (state.meta.lastThought as string) ?? "";
  const toolCallsForHistory = normalizedPendingCalls
    .filter((tc) => {
      // Only include tool calls that were actually attempted (their action step exists)
      return newStepsThisTurn.some(
        (s) => s.type === "action" && (s.metadata?.toolCall as { id?: string } | undefined)?.id === tc.id,
      );
    })
    .map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));

  // Build tool result messages — match each tool call to its observation by toolCallId.
  // Parallel batches layout steps as [a1,a2,a3,o1,o2,o3] so positional +1 adjacency
  // doesn't work; toolCallId metadata is the stable link.
  //
  // Sprint 3.4 (G-4 closure) — when an observation has a storedKey, look up
  // the FULL content from the shared scratchpad and use that instead of the
  // compressed [STORED:] marker that obsStep.content carries. This is the
  // critical fix: the model's conversation thread now sees real tool data,
  // not a compression marker forcing it to call recall(). Per-tool cap
  // prevents context blowup; older observations get their natural context-
  // window decay via applyMessageWindowWithCompact.
  const TOOL_RESULT_INLINE_CAP = 4000;
  const toolResultMessages: KernelMessage[] = normalizedPendingCalls.flatMap((tc) => {
    const obsStep = newStepsThisTurn.find(
      (s) => s.type === "observation" && s.metadata?.toolCallId === tc.id,
    );
    if (!obsStep) return [];
    const storedKey = obsStep.metadata?.storedKey as string | undefined;
    const fullFromScratchpad = storedKey ? sharedScratchpad.get(storedKey) : undefined;
    // When the full result doesn't fit the inline cap, fall back to
    // `obsStep.content` — the ALREADY-computed structured compressToolResult
    // preview — instead of blind-slicing the raw full text. A character slice
    // has no notion of item/line boundaries: it can cut mid-record (breaking
    // valid JSON) and silently drops whatever fell past the cut with only a
    // generic "...truncated (N chars)" note, no signal of how many real items
    // were lost. The compressed preview already carries an honest "M of N
    // shown" count and a working recall() hint (2026-07-30 — root cause of a
    // live run silently losing 21 of 25 requested commits mid-string).
    const resolvedContent =
      fullFromScratchpad && fullFromScratchpad.length <= TOOL_RESULT_INLINE_CAP
        ? fullFromScratchpad
        : obsStep.content;
    const msg: KernelMessage = {
      role: "tool_result" as const,
      toolCallId: tc.id,
      toolName: tc.name,
      content: resolvedContent,
      ...(storedKey ? { storedKey } : {}),
    };
    return [msg];
  });

  if (toolCallsForHistory.length === 0) {
    // No tool calls actually appended (all skipped/blocked) — don't add to history
    return { messages: prior, actReminder: undefined, errorRecovery: undefined, completionNudgeSent: false };
  }

  const assistantMsg: KernelMessage = {
    role: "assistant",
    content: assistantThought,
    toolCalls: toolCallsForHistory,
  };
  const baseMessages = [...prior, assistantMsg, ...toolResultMessages];

  // Append progress summary for reactive strategy: tells the model what it did
  // and what's left. This is critical for local/mid models that don't infer
  // next steps from conversation structure alone.
  const reqTools = input.requiredTools ?? [];
  const usedSoFar = [...newToolsUsed];
  const reqQuantities = input.requiredToolQuantities;
  const successfulToolCounts = buildSuccessfulToolCallCounts(allSteps);
  const missing = getEffectiveMissingRequiredTools(
    allSteps,
    reqTools,
    reqQuantities,
  );

  if (missing.length > 0) {
    // Check if this is a research->produce transition: all search-type tools
    // satisfied, only output tools (write/file/save) remain.
    const RESEARCH_KEYWORDS = ["search", "http", "browse", "fetch", "scrape", "crawl"];
    const researchDone = usedSoFar.some((t) => RESEARCH_KEYWORDS.some((k) => t.includes(k)));
    const outputOnly = missing.every((t) => t.includes("write") || t.includes("file") || t.includes("save"));
    const observationCount = allSteps.filter((s) => s.type === "observation" &&
      (s.metadata?.observationResult as { toolName?: string } | undefined)?.toolName !== "system").length;

    const synthesisMsg = researchDone && outputOnly
      ? adapter.synthesisPrompt?.({
          toolsUsed: newToolsUsed,
          missingOutputTools: missing,
          observationCount,
          tier: profile.tier ?? "mid",
        })
      : undefined;

    const missingWithCounts = missing.map((t) => {
      const needed = reqQuantities?.[t];
      if (!needed || needed <= 1) return t;
      const actual = successfulToolCounts[t] ?? 0;
      return `${t} (${actual}/${needed} calls done)`;
    });
    const progressContent = synthesisMsg
      ?? `You must still call: ${missingWithCounts.join(", ")}. Call ${missing[0]} now with the appropriate arguments.`;

    return { messages: baseMessages, actReminder: progressContent, errorRecovery: undefined, completionNudgeSent: false };
  }

  // All required tools called — tell model to finish (but not while previews still hide data behind recall).
  // Only send this nudge ONCE per run to avoid contradictory repeated messages.
  //
  // Sequential mode (all quantities ≤ 1): the "satisfied" condition only means each
  // tool was called once — a weak signal, so this branch used to say NOTHING at
  // all rather than risk the aggressive "FINAL ANSWER" push cutting off
  // legitimate continued research. Measured cost (live-model QA, 2026-08-16,
  // cogito:8b/gemma4:e4b/qwen3:4b across rw-4/rw-8/rw-9 — all single-quantity
  // required-tools tasks): smaller local models routinely satisfy their
  // required tools, then just stop (`end_turn`) without ever calling
  // final-answer, because nothing told them finishing was now an option. The
  // harness's fallback (harness_deliverable + output-gate reformat) recovers
  // an answer either way, but every one of those runs pays an extra
  // stall-detection + reformatting pass a proactive, softer nudge avoids
  // outright. Unlike the multi-quantity nudge below, this one is informational
  // ("you may finish"), not mandatory ("FINAL ANSWER now") — it still leaves
  // the model free to keep researching.
  if (reqTools.length > 0) {
    const hasMultiQuantity = Object.values(reqQuantities ?? {}).some((n) => n > 1);
    const alreadySentCompletion = state.meta.completionNudgeSent === true;

    if (!alreadySentCompletion) {
      const overflowPreview = toolResultMessages.some(
        (m) => typeof m.content === "string" && observationReferencesStoredOverflow(m.content),
      );
      const recallAvailable = (input.allToolSchemas ?? input.availableToolSchemas ?? []).some(
        (s) => s.name === "recall",
      );
      const finishText = hasMultiQuantity
        ? (overflowPreview && recallAvailable
          ? `${REQUIRED_TOOLS_SATISFIED_PREFIX}. The observations above are compressed previews; the real command output is stored under keys like _tool_result_1. Before summarizing, call recall("<that-key>", full: true) for each key shown in the [STORED: …] header. Do not invent CLI flags, subcommands, or options — only report text you retrieved via recall.`
          : `${REQUIRED_TOOLS_SATISFIED_PREFIX}. Review ALL of the tool results above carefully — extract the specific data points you need from each one. Then give your FINAL ANSWER using only data from these results.`)
        : (overflowPreview && recallAvailable
          ? `${REQUIRED_TOOLS_SATISFIED_PREFIX}. The observations above are compressed previews; call recall("<that-key>", full: true) for the stored keys shown in the [STORED: …] header if you need the full content. If you have what you need, give your final answer now — otherwise continue.`
          : `${REQUIRED_TOOLS_SATISFIED_PREFIX}. If you have what you need from the results above, give your final answer now — you don't need to call anything else unless more information is genuinely required.`);
      return { messages: baseMessages, actReminder: finishText, errorRecovery: undefined, completionNudgeSent: true };
    }

    // Completion gate already sent but this turn had errors — nudge to retry or finish.
    if (hasMultiQuantity) {
      const thisRoundHadErrors = newStepsThisTurn.some(
        (s) => s.type === "observation" &&
          (s.metadata?.observationResult as { success?: boolean } | undefined)?.success === false,
      );
      if (thisRoundHadErrors) {
        const retryText = "One or more tool calls above failed. If you used a wrong tool name, retry with the correct tool name shown in the system prompt. If you have enough data, give your FINAL ANSWER now.";
        return { messages: baseMessages, actReminder: undefined, errorRecovery: retryText, completionNudgeSent: false };
      }
    }
  }

  return { messages: baseMessages, actReminder: undefined, errorRecovery: undefined, completionNudgeSent: false };
}
