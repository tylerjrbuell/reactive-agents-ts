/**
 * context/guidance.ts — harness guidance signals → prompt text.
 *
 * Live home for GuidanceContext + buildGuidanceText (hotfix 0.5-1,
 * 2026-07-07). Both previously lived in the dead ContextManager/APC stack
 * (context-manager.ts / prompt-sections-default.ts), which had no live
 * caller — so every guidance signal (required-tools nudge, loop-detected
 * message incl. the harness `nudge.loop-detected` transform, ICS guidance,
 * oracle guidance, error recovery, act reminder, quality-gate hint,
 * evidence gap) was assembled each think turn, `state.pendingGuidance` was
 * read-and-CLEARED, and the rendered text never reached the model.
 *
 * think.ts now renders this into the dynamic tail of the system prompt
 * (after assembly, alongside driver/rationale instructions) so guidance
 * lands without disturbing the stable prompt prefix.
 *
 * APC-0 evidence (2026-05): stripping harness guidance caused +42% to +136%
 * output inflation on tool/multi-step paths — guidance is load-bearing.
 */

export interface GuidanceContext {
  /** Required tools not yet called this run. */
  readonly requiredToolsPending: readonly string[];
  /** True when the loop-detection oracle fired on this iteration. */
  readonly loopDetected: boolean;
  /** Custom nudge text produced by a harness nudge.loop-detected transform. Overrides the default when set. */
  readonly loopDetectedMessage?: string;
  /** Guidance from the Intelligent Context Synthesis (ICS) system. */
  readonly icsGuidance?: string;
  /** Guidance from the oracle / quality gate. */
  readonly oracleGuidance?: string;
  /** Recovery hint when an error occurred on the previous round. */
  readonly errorRecovery?: string;
  /** Post-act harness reminder surfaced after a tool round (progress / finish cues). */
  readonly actReminder?: string;
  /** Adapter quality-check hint rendered before accepting a prose final answer. */
  readonly qualityGateHint?: string;
  /** Evidence grounding redirect when claims lack tool support. */
  readonly evidenceGap?: string;
  /** Advisory gather-dedup nudge — a repeated (tool, args) gather was detected;
   *  hands back the existing recallable ref instead of re-fetching (C3). */
  readonly gatherDedup?: string;
}

/**
 * Render active guidance signals as a compact `Guidance:` block, or null
 * when no signal is active (the common case — zero prompt cost).
 */
export function buildGuidanceText(guidance: GuidanceContext): string | null {
  const signals: string[] = [];

  if (guidance.requiredToolsPending.length > 0) {
    signals.push(
      `REQUIRED tools not yet called: ${guidance.requiredToolsPending.join(", ")}. Call these before giving a final answer.`,
    );
  }
  if (guidance.loopDetected) {
    signals.push(
      guidance.loopDetectedMessage ??
        "Loop detected: you are repeating the same tool calls. Try a different approach or synthesize what you have.",
    );
  }
  if (guidance.icsGuidance) signals.push(guidance.icsGuidance);
  if (guidance.oracleGuidance) signals.push(guidance.oracleGuidance);
  if (guidance.errorRecovery) signals.push(guidance.errorRecovery);
  if (guidance.actReminder) signals.push(guidance.actReminder);
  if (guidance.qualityGateHint) signals.push(guidance.qualityGateHint);
  if (guidance.gatherDedup) signals.push(guidance.gatherDedup);
  if (guidance.evidenceGap) {
    signals.push(
      `Your answer contains claims not supported by tool results: ${guidance.evidenceGap}. Revise using only data from the Observations above.`,
    );
  }

  if (signals.length === 0) return null;
  return `Guidance:\n${signals.map((s) => `- ${s}`).join("\n")}`;
}
