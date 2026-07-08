// File: src/kernel/ledger/artifact-projection.ts
//
// Artifact truth (Wave C / task C2, audit 01-F1) — derives `artifact` ledger
// entries from the steps of a tool round, using the tool's DECLARED `produces`
// field (via @reactive-agents/tools `resolveProduces`) instead of the old
// 4-name `WRITING_TOOL_NAMES` / 15-key path heuristic.
//
// A produced artifact is a FACT emitted at the tool boundary: a successful
// observation from a `produces:"file"` tool, linked (by toolCallId) to its
// originating action whose args name the written path(s). code-execute and
// shell-execute file writes — invisible to the old set — are now first-class.
//
// Pure — no Effect, no state, no I/O. act.ts calls this over a round's NEW steps
// and appends the result to the ledger via `patch.ledger` at the transition
// (same seam the terminal-verdict/claim emitters use); the C1 chokepoint owns
// tool-invocation/tool-result/verdict projection and is untouched.

import type { ReasoningStep } from "../../types/index.js";
import { extractArtifactFacts, type ProducesKind } from "@reactive-agents/tools";
import {
  entriesOfKind,
  type ArtifactEntry,
  type LedgerEntryInput,
  type RunLedger,
} from "./run-ledger.js";

interface ToolCallMeta {
  readonly id?: string;
  readonly name?: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

interface ObservationResultMeta {
  readonly success?: boolean;
}

/**
 * Derive the `artifact` ledger inputs produced by `newSteps` (one round's newly
 * appended steps). For each SUCCESSFUL observation from a `produces:"file"` tool,
 * linked by toolCallId to its action, the per-builtin path-extraction contract
 * ({@link extractArtifactFacts}) yields one entry per written path.
 *
 * `produces` is injected (act.ts passes the tools-package `resolveProduces`) so
 * this stays pure and unit-testable without the live registry.
 */
export function deriveArtifactEntries(
  newSteps: readonly ReasoningStep[],
  produces: (toolName: string) => ProducesKind,
  iteration: number,
): LedgerEntryInput[] {
  // Index FILE-producing actions by toolCallId. Non-file tools are excluded up
  // front so a `data`/`none` tool never reaches the extractor.
  const fileActions = new Map<
    string,
    { readonly toolName: string; readonly args: Record<string, unknown> }
  >();
  for (const step of newSteps) {
    if (step.type !== "action") continue;
    const tc = step.metadata?.toolCall as ToolCallMeta | undefined;
    const name = tc?.name;
    const id = tc?.id;
    if (typeof name !== "string" || name.length === 0) continue;
    if (typeof id !== "string" || id.length === 0) continue;
    if (produces(name) !== "file") continue;
    fileActions.set(id, {
      toolName: name,
      args: (tc?.arguments as Record<string, unknown>) ?? {},
    });
  }

  const out: LedgerEntryInput[] = [];
  for (const step of newSteps) {
    if (step.type !== "observation") continue;
    // Only SUCCESSFUL writes mint artifacts (false-UNMET is the safe direction).
    const obs = step.metadata?.observationResult as ObservationResultMeta | undefined;
    if (obs?.success !== true) continue;
    const linkId = step.metadata?.toolCallId;
    if (typeof linkId !== "string") continue;
    const action = fileActions.get(linkId);
    if (!action) continue;
    for (const fact of extractArtifactFacts(action.toolName, action.args)) {
      out.push({
        kind: "artifact",
        iteration,
        path: fact.path,
        op: fact.op,
        ...(fact.digest !== undefined ? { digest: fact.digest } : {}),
        toolCallId: linkId,
      });
    }
  }
  return out;
}

/** All artifact entries in the ledger (audit 01-F1: the enumerable record). */
export function artifacts(ledger: RunLedger | undefined): readonly ArtifactEntry[] {
  return entriesOfKind(ledger, "artifact");
}
