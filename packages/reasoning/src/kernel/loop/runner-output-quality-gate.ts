/**
 * runner-output-quality-gate.ts — §9 output quality gate, decomposed VERBATIM
 * from runner.ts (quality program Task 9 / GH #222; formerly lines 1704-1864).
 *
 * Routes a successful `done` run's output through the canonical finalization
 * pipeline: termination-source classification, format/content validation,
 * the synthesis branch (with the file-deliverable scoping rule), and the
 * de-scaffold floor. The runner keeps the single call site.
 */
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService } from "@reactive-agents/llm-provider";
import { harnessSynthesisDeliverable } from "@reactive-agents/core";
import type { TaskIntent } from "../../kernel/capabilities/comprehend/task-intent.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { gatewayComplete } from "../llm-gateway.js";
import {
  transitionState,
  type KernelState,
  type KernelInput,
} from "../../kernel/state/kernel-state.js";
import {
  validateOutputFormat,
  validateContentCompleteness,
  buildFinalAnswerCandidate,
  finalizeOutput,
  buildSynthesisPrompt,
  deScaffoldRawDeliverable,
} from "./output-synthesis.js";
import { commitDeliverable } from "./runner-helpers/deliverable.js";

/** Run the §9 output quality gate over a finalized `state` (Effect). */
export function runOutputQualityGate(args: {
  state: KernelState;
  readonly effectiveInput: KernelInput;
  readonly taskIntent: TaskIntent;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  readonly isAwaitingApproval: boolean;
  readonly isAwaitingInteraction: boolean;
  readonly isAbstained: boolean;
  readonly isBudgetTerminal: boolean;
}): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    let { state } = args;
    const { effectiveInput, taskIntent, emitLog, isAwaitingApproval, isAwaitingInteraction, isAbstained, isBudgetTerminal } = args;

    // ── 9. Output quality gate ────────────────────────────────────────────
    // Route all successful outputs through the canonical finalization pipeline.
    // Validates format, optionally synthesizes when LLM is available.
    // Harness-assembled output (raw tool artifacts) always attempts synthesis.
    if (
      state.status === "done" &&
      state.output &&
      !isAwaitingApproval &&
      !isAwaitingInteraction &&
      !isAbstained &&
      !isBudgetTerminal
    ) {
      // `harness_synthesis` (introduced when assembleDeliverable picks a
      // substantive model thought) is treated as a MODEL output here — the
      // text was authored by the LLM, not concatenated from raw tool JSON.
      // Routing it as "harness" would force a second LLM re-synthesis that
      // can degrade clean prose into hallucinated structured output (e.g.,
      // local small models compressing/reformatting valid answers).
      const terminationSource = (state.meta.terminatedBy === "oracle_forced" ? "oracle"
        : state.meta.terminatedBy === "harness_deliverable" || state.meta.terminatedBy === "low_delta_guard" ? "harness"
        : "model") as "model" | "harness" | "oracle" | "fallback";
      const candidate = buildFinalAnswerCandidate(
        state.output,
        terminationSource,
        taskIntent,
      );
      const finalized = yield* finalizeOutput(candidate, taskIntent, effectiveInput.task);

      // `taskIntent.format` is a regex parse of the raw task string — it can't
      // tell "write a markdown table to ./out.md" (deliverable = the FILE)
      // apart from "give me a markdown table" (deliverable = the chat reply
      // itself). The RunContract already makes that distinction explicitly
      // (`deliverables: [{kind:"file", ...}]` from deriveDeliverablePaths, run-
      // contract.ts:278) — a file deliverable means the real output already
      // landed via a tool call, and the chat reply's job is just to confirm
      // that, not restate the file's content in its format. Without this
      // check, a plain "wrote it to ./crypto.md" confirmation gets forced
      // through an LLM resynthesis pass trying to turn it into a markdown
      // table (with no fetched data to draw one from), fails both format and
      // content validation, and logs a scary-looking but harmless
      // "[output-gate] Synthesis attempted but validation still failed"
      // warning on a run that actually succeeded (confirmed live via
      // rax-diagnose on scratch.ts's "fetch crypto prices ... write to
      // ./crypto.md" task — file was written correctly, only the redundant
      // chat-reply reformat failed).
      const hasFileDeliverable = (state.meta.runContract?.deliverables ?? []).some(
        (d) => d.kind === "file",
      );
      // Only the FORMAT trigger is scoped by hasFileDeliverable — the
      // harness/oracle trigger stays independent. Those sources mean the
      // model never produced real prose (raw tool JSON got assembled as the
      // "answer"), which is worth cleaning up regardless of whether a file
      // was also written; it's a readability fix, not a format-matching one.
      const formatAppliesToReply = Boolean(taskIntent.format) && !hasFileDeliverable;

      // Determine if synthesis is needed:
      // 1. Explicit format requested (for the REPLY, not a file deliverable) but validation failed
      // 2. Harness/oracle source — raw tool artifacts need professional formatting
      const needsSynthesis = !finalized.formatValidated &&
        (formatAppliesToReply || terminationSource === "harness" || terminationSource === "oracle");

      if (needsSynthesis) {
        const llmOpt = yield* Effect.serviceOption(LLMService);
        if (llmOpt._tag === "Some") {
          const synthesisFormat = formatAppliesToReply ? taskIntent.format! : "prose";
          const synthesisPrompt = buildSynthesisPrompt(state.output, synthesisFormat, effectiveInput.task, taskIntent);
          // H3 (2026-07-08, audit 05-E2): format/quality re-synthesis replaces
          // state.output wholesale — the deliverable render, not a side call.
          const synthesized = yield* gatewayComplete(llmOpt.value, { purpose: "synthesize", budgetClass: "generous" }, {
            messages: [{ role: "user", content: synthesisPrompt }],
            temperature: 0.2,
          }).pipe(Effect.catchAll(() => Effect.succeed({ content: "" })));

          // Strip <think> blocks before the synthesized output is gated on
          // format/completeness OR written into state.output. Without this,
          // thinking-model preambles leak verbatim into the user-facing
          // final answer.
          const safeSynth = extractThinkingSafeContent(synthesized);
          const synthContent = safeSynth.content;

          if (synthContent && synthContent.length > 0) {
            const formatOk = formatAppliesToReply
              ? validateOutputFormat(synthContent, taskIntent.format!).valid
              : true;
            const contentOk = validateContentCompleteness(synthContent, taskIntent).complete;

            if (formatOk && contentOk) {
              // Drift S11: synthContent is prose the HARNESS produced by running
              // the LLM synthesis call above — NOT a model-authored trailing
              // thought. Tag it `harness_synthesis` WITH `synthesized` so the
              // provenance is truthful; `deliverableToContent` returns
              // synthContent unchanged (synthesized wins over the empty
              // `assembled`), so the output string is byte-identical to the old
              // model_synthesis write. No `synthesisCall` ref: `complete()`
              // exposes no callId here, and the contract forbids fabricating one.
              // extraMeta carries ONLY the output-quality flags; terminatedBy is
              // already set and preserved (commitDeliverable merges, never clobbers).
              state = commitDeliverable(
                state,
                harnessSynthesisDeliverable([], undefined, synthContent),
                { outputSynthesized: true, outputFormatValidated: true },
              );
              yield* emitLog({
                _tag: "warning",
                message: `Rewrote the answer to match the requested ${synthesisFormat} format.`,
                context: `[output-gate] synthesized output to match requested format: ${synthesisFormat}`,
                timestamp: new Date(),
              });
            } else if (terminationSource === "harness" || terminationSource === "oracle") {
              // Drift S11 (imperfect-but-better-than-raw branch): same provenance
              // truth as the formatOk&&contentOk branch — harness-orchestrated
              // synthesis → harness_synthesis WITH synthesized. Output string and
              // terminatedBy unchanged from the prior model_synthesis write.
              state = commitDeliverable(
                state,
                harnessSynthesisDeliverable([], undefined, synthContent),
                { outputSynthesized: true, outputFormatValidated: formatOk, outputFormatReason: !formatOk ? "Format mismatch after synthesis" : !contentOk ? "Content incomplete after synthesis" : undefined },
              );
              yield* emitLog({ _tag: "warning", message: `[output-gate] Synthesis imperfect but using over raw artifacts (format=${formatOk}, content=${contentOk})`, timestamp: new Date() });
            } else {
              state = transitionState(state, {
                meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
              });
              yield* emitLog({ _tag: "warning", message: `[output-gate] Synthesis attempted but validation still failed (format=${formatOk}, content=${contentOk})`, timestamp: new Date() });
            }
          } else if (terminationSource === "harness" || terminationSource === "oracle") {
            // LLM synthesis was attempted but returned empty content (weak
            // local models fail this call in practice — see
            // deScaffoldRawDeliverable's docstring). Shipping the raw
            // harness_synthesis join verbatim means the user sees internal
            // `✓ toolName: ` scaffolding as if it were the answer. Strip that
            // scaffolding as a deterministic floor under the failed LLM call
            // — honestly still unsynthesized (outputSynthesized stays false),
            // but no longer visibly an internal artifact dump.
            state = commitDeliverable(
              state,
              harnessSynthesisDeliverable([], undefined, deScaffoldRawDeliverable(state.output ?? "")),
              { outputFormatValidated: false, outputFormatReason: finalized.validationReason },
            );
          } else {
            state = transitionState(state, {
              meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
            });
          }
        } else {
          state = transitionState(state, {
            meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
          });
        }
      } else if (taskIntent.format && !hasFileDeliverable) {
        // Format was requested and validated successfully. Skipped for a
        // file-deliverable task — hasFileDeliverable means the format
        // constraint applies to the FILE (already written by a tool call),
        // not the chat reply, so "no synthesis needed" here says nothing
        // about whether the reply itself matches the format — it doesn't
        // need to.
        state = transitionState(state, {
          meta: { ...state.meta, outputFormatValidated: true },
        });
      }
    }
    return state;
  });
}
