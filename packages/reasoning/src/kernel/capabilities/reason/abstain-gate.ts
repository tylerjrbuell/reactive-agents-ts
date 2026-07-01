export interface AbstainGateInputs {
    readonly enabled: boolean;
    readonly iteration: number;
    readonly requiredToolUnavailable: boolean;
    readonly toolsAttempted: number;
}

/**
 * Offer the `abstain` action only once the model has had a real chance to work,
 * OR immediately when a required tool is structurally unavailable. Never on
 * iteration 0 of a fresh, tool-solvable task — this removes the instant-bail.
 */
export function shouldOfferAbstain(i: AbstainGateInputs): boolean {
    if (!i.enabled) return false;
    if (i.requiredToolUnavailable) return true;
    return i.iteration >= 1;
}
