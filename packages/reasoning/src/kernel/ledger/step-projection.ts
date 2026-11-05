// File: src/kernel/ledger/step-projection.ts
//
// Dual-emit derivation (Wave C / task C1): the RunLedger is GROWN FROM steps[].
// This module is the pure step-type → ledger-kind mapping the `transitionState`
// chokepoint applies to every NEW step a transition appends. `state.steps`
// stays the authoritative source of truth (byte-identical behavior); the ledger
// grows ALONGSIDE it as the higher-value, queryable projection.
//
// C-final RESOLVED as the equivalence invariant (ratified 2026-07-22,
// wiki/Decisions/2026-07-22-c1-equivalence-invariant.md): steps[] stays the
// in-loop record, mutated only via the transitionState chokepoint; the ledger
// grows alongside it and equivalence.test.ts pins ledger ≡ projection(steps).
// The physical write-direction flip was declined (lossy-by-design projection;
// see the decision doc). The ledger is canonical for all NEW readers.
//
// Pure — no Effect, no state, no I/O. Reads only the step + its metadata.

import type { ReasoningStep } from "../../types/index.js";
import { evidenceFromStep } from "../../assembly/evidence-entry.js";
import { GUARD_OBSERVATION_TAG } from "../state/kernel-constants.js";
import { foldToolEvidence, type ToolEvidence } from "../capabilities/verify/requirement-state.js";
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
  readonly delegatedToolsUsed?: readonly string[];
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
        frameworkInstrumentation?: string;
        toolUsed?: string;
        verification?: unknown;
        subAgentLedger?: RunLedger;
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
      // A delegation credits the tools its child used (one level, already rolled
      // up from deeper levels by the executor) — tool evidence reads this.
      const delegated = Array.isArray(obs?.delegatedToolsUsed)
        ? obs.delegatedToolsUsed.filter((t): t is string => typeof t === "string" && t.length > 0)
        : [];
      const entries: LedgerEntryInput[] = [
        {
          kind: "tool-result",
          iteration,
          success: obs?.success ?? true,
          preview: ev.preview,
          ...(toolName !== undefined ? { toolName } : {}),
          ...(meta?.toolCallId !== undefined ? { toolCallId: meta.toolCallId } : {}),
          ...(delegated.length > 0 ? { delegatedToolsUsed: delegated } : {}),
          ...(ev.storedKey !== undefined ? { storedKey: ev.storedKey } : {}),
          ...(ev.extractedFact !== undefined ? { extractedFact: ev.extractedFact } : {}),
          ...(meta?.frameworkInstrumentation === GUARD_OBSERVATION_TAG ? { harnessAuthored: true as const } : {}),
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
      // Wave C.2 — a sub-agent tool observation carries the child's ledger,
      // already stamped `sub-agent:<name>` by the executor. Its entries merge
      // into the parent's ledger right after the spawn call's own tool-result,
      // so the child's tool calls / artifacts / verdicts become queryable facts
      // of the parent run instead of dying as a summary string. `appendEntries`
      // (via projectStepsToLedger / the ledgerSink) re-bases their seq into the
      // parent's dense index; the `pass` stamp — innermost-wins for a grandchild
      // — rides through untouched because it lives on the entry, not the seq.
      if (meta?.subAgentLedger && meta.subAgentLedger.length > 0) {
        for (const { seq: _childSeq, ...rest } of meta.subAgentLedger) {
          entries.push(rest as LedgerEntryInput);
        }
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

/**
 * The tool evidence `transitionState` will hold once `newSteps` land — for a
 * reader holding a turn's steps BEFORE they are transitioned (conversation
 * assembly renders progress mid-act). Same projection, same fold, no second
 * definition of a successful call. Pure; grows no run ledger.
 */
export function evidenceAfterSteps(
  prior: ToolEvidence,
  newSteps: readonly ReasoningStep[],
  iteration: number,
): ToolEvidence {
  return newSteps.length === 0 ? prior : foldToolEvidence(prior, projectStepsToLedger([], newSteps, iteration));
}

/**
 * The run's tool evidence once `steps` land, where `steps` is `state.steps`
 * followed by this turn's not-yet-transitioned steps (the act phase's running
 * `allSteps`). The earlier steps are already folded into `state.evidence`, so
 * only the tail past `state.steps.length` is projected.
 */
export function evidenceThrough(
  state: { readonly evidence: ToolEvidence; readonly steps: readonly ReasoningStep[]; readonly iteration: number },
  steps: readonly ReasoningStep[],
): ToolEvidence {
  return evidenceAfterSteps(state.evidence, steps.slice(state.steps.length), state.iteration);
}
