export interface AbstentionLegitimacyInput {
    readonly taskRequiresTools: boolean;
    readonly requiredToolsAttempted: boolean;
    readonly requiredToolUnavailable: boolean;
    readonly ungroundedSynthesisRejections: number;
    readonly iterationsRemaining: number;
}

export interface AbstentionLegitimacyVerdict {
    readonly legitimate: boolean;
    readonly nudge?: string;
}

/**
 * Deterministic: an abstention is EARNED when the model genuinely tried or
 * grounding is structurally impossible. A premature bail (tool-solvable task,
 * required tools never attempted, iterations still available) is rejected and
 * nudged back to work.
 */
export function checkAbstentionLegitimacy(i: AbstentionLegitimacyInput): AbstentionLegitimacyVerdict {
    if (!i.taskRequiresTools) return { legitimate: true };
    if (i.requiredToolUnavailable) return { legitimate: true };
    if (i.requiredToolsAttempted) return { legitimate: true };
    if (i.ungroundedSynthesisRejections >= 2) return { legitimate: true };
    if (i.iterationsRemaining <= 0) return { legitimate: true };
    return {
        legitimate: false,
        nudge:
            "You have not yet attempted the tools needed to ground an answer. " +
            "Try them before abstaining — abstention is for when grounding is genuinely impossible.",
    };
}
