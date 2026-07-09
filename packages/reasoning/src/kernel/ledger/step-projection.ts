// File: src/kernel/ledger/step-projection.ts
//
// Dual-emit derivation (Wave C / task C1): the RunLedger is GROWN FROM steps[].
// This module is the pure step-type → ledger-kind mapping the `transitionState`
// chokepoint applies to every NEW step a transition appends. `state.steps`
// stays the authoritative source of truth (byte-identical behavior); the ledger
// grows ALONGSIDE it as the higher-value, queryable projection.
//
// TODO(C-final): steps becomes a PROJECTION of the ledger. That flip is the
// LAST step of Wave C and is explicitly NOT in this task — today this is
// additive dual-emit only. When it lands, this mapping inverts (ledger →
// steps) and the chokepoint stops deriving here.
//
// Pure — no Effect, no state, no I/O. Reads only the step + its metadata.

import type { ReasoningStep } from "../../types/index.js";
import { evidenceFromStep } from "../../assembly/evidence-entry.js";
import {
  appendEntries,
  type LedgerEntryInput,
  type RunLedger,
} from "./run-ledger.js";

/** Bounded preview length for tool-result content (full content lives on steps/refs). */
const PREVIEW_MAX = 240;

interface ToolCallMeta {
  readonly id?: string;
  readonly name?: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

interface ObservationResultMeta {
  readonly success?: boolean;
  readonly toolName?: string;
}

interface VerificationMeta {
  readonly verified?: boolean;
  readonly summary?: string;
}

/** Parse the tool name from an `action` step's `toolName(...)` content form. */
function toolNameFromContent(content: string): string {
  const paren = content.indexOf("(");
  const name = (paren >= 0 ? content.slice(0, paren) : content).trim();
  return name.length > 0 ? name : "unknown-tool";
}

/**
 * Map ONE step to its ledger entry input(s). Returns 0..2 entries:
 *   - action           → [tool-invocation]
 *   - observation      → [tool-result] (+ [verdict] when metadata.verification present)
 *   - harness_signal   → [harness-signal]
 *   - thought/plan/reflection/critique → [] (not high-value ledger facts)
 */
/**
 * The mid-loop verification gates, keyed by the pseudo-`toolName` each one
 * stamps on its observation step via `makeObservationResult(<gate>, ok, msg)`.
 *
 * These are the sites where the harness inspects a PROPOSED completion and can
 * push the run back into the loop:
 *   - `completion-guard`        — think.ts:1595 ("Not done yet — …", redirect)
 *   - `abstention-legitimacy`   — think.ts:1284 (illegitimate abstain → nudge)
 *
 * A rejection here is exactly "the run tried to finish and verification said no",
 * which is what `assess()` reads to enter the `verify` phase. Deliberately a
 * closed set, not a catch-all: ordinary tool observations must NOT mint verdicts
 * (they already project a `tool-result`), or the phase would pin to `verify`.
 */
const IN_LOOP_VERDICT_GATES: ReadonlySet<string> = new Set([
  "completion-guard",
  "abstention-legitimacy",
]);

export function stepToEntries(step: ReasoningStep, iteration: number): LedgerEntryInput[] {
  const meta = step.metadata as
    | {
        toolCall?: ToolCallMeta;
        toolCallId?: string;
        observationResult?: ObservationResultMeta;
        storedKey?: string;
        extractedFact?: string;
        toolUsed?: string;
        verification?: unknown;
      }
    | undefined;

  switch (step.type) {
    case "action": {
      const toolName = meta?.toolCall?.name ?? toolNameFromContent(step.content);
      const args = meta?.toolCall?.arguments;
      const toolCallId = meta?.toolCallId ?? meta?.toolCall?.id;
      return [
        {
          kind: "tool-invocation",
          iteration,
          toolName,
          ...(args !== undefined ? { args } : {}),
          ...(toolCallId !== undefined ? { toolCallId } : {}),
          stepId: step.id,
        },
      ];
    }
    case "observation": {
      const obs = meta?.observationResult;
      const toolName = obs?.toolName ?? meta?.toolUsed;
      // C3 (2026-07-08): the `tool-result` ledger entry is a PROJECTION of the
      // unified EvidenceEntry facet — preview + the (recallable-only) storedKey +
      // extractedFact all come from ONE builder rather than being re-derived
      // inline here (audit 03-#14).
      const ev = evidenceFromStep(step, PREVIEW_MAX);
      const entries: LedgerEntryInput[] = [
        {
          kind: "tool-result",
          iteration,
          success: obs?.success ?? true,
          preview: ev.preview,
          ...(toolName !== undefined ? { toolName } : {}),
          ...(meta?.toolCallId !== undefined ? { toolCallId: meta.toolCallId } : {}),
          ...(ev.storedKey !== undefined ? { storedKey: ev.storedKey } : {}),
          ...(ev.extractedFact !== undefined ? { extractedFact: ev.extractedFact } : {}),
          stepId: step.id,
        },
      ];
      // verify() output rides on observation step metadata (act.ts attaches it).
      // Persist it as a first-class per-step verdict (audit 01: verdicts were
      // recorded only on step metadata, never queryable as ledger facts).
      const verif = meta?.verification as VerificationMeta | undefined;
      if (verif !== undefined && typeof verif.verified === "boolean") {
        entries.push({
          kind: "verdict",
          iteration,
          gate: "per-step",
          verified: verif.verified,
          ...(verif.summary !== undefined ? { reason: verif.summary } : {}),
        });
      }
      // The MID-LOOP verification gates. `gate: "in-loop"` was declared on
      // VerdictEntry and had zero writers, so `assess()`'s only verify-phase
      // signal was the TERMINAL verdict — which is minted exclusively by the
      // arbitrator's exit transitions and therefore never exists while the loop
      // is still running. The verify phase was unreachable (wiring audit
      // 2026-07-09). These guards already record their outcome as an observation
      // step tagged with the gate name; projecting it here makes the verdict a
      // queryable ledger fact WITHOUT any guard hand-building a ledger entry, so
      // the ledger single-writer invariant (check-ledger-writes.sh) still holds.
      if (toolName !== undefined && IN_LOOP_VERDICT_GATES.has(toolName)) {
        entries.push({
          kind: "verdict",
          iteration,
          gate: "in-loop",
          verified: obs?.success ?? false,
          reason: step.content,
        });
      }
      return entries;
    }
    case "harness_signal":
      return [
        { kind: "harness-signal", iteration, signal: step.content, stepId: step.id },
      ];
    default:
      return [];
  }
}

/**
 * Grow `ledger` by the entries derived from `newSteps`, continuing seq
 * numbering. Pure — returns a NEW ledger.
 */
export function projectStepsToLedger(
  ledger: RunLedger | undefined,
  newSteps: readonly ReasoningStep[],
  iteration: number,
): RunLedger {
  const inputs: LedgerEntryInput[] = [];
  for (const s of newSteps) inputs.push(...stepToEntries(s, iteration));
  return appendEntries(ledger, inputs);
}
