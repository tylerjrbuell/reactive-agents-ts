/**
 * Unresolved-tool-call step predicates (F2 follow-up, 2026-10-29).
 *
 * A reply that was tool-call-shaped but unresolvable is recorded as a thought
 * step tagged `frameworkInstrumentation: "unresolved-tool-call"` (content = raw
 * reply + the resolver hint), PLUS an untagged "twin" thought holding the raw
 * reply. Neither is model prose: loop patterns must not count them, strategy
 * switches must carry them (so the strike count survives the steps reset), and
 * no output fallback may deliver them. Pure helpers, no kernel imports, so the
 * loop-detector (reflect) and the strike guard (reason) share ONE definition.
 */
import type { ReasoningStep } from "../../../types/index.js";

/** `frameworkInstrumentation` tag stamped on a shaped-reply thought step. */
export const UNRESOLVED_TOOL_CALL_TAG = "unresolved-tool-call";

const isTagged = (s: ReasoningStep): boolean =>
  s.type === "thought" && s.metadata?.frameworkInstrumentation === UNRESOLVED_TOOL_CALL_TAG;

/**
 * The shaped-reply thought run at the tail of `steps` (tagged thoughts and
 * their untagged twins, in order). An action or any other thought ends the run;
 * observations are skipped and not collected.
 */
export function trailingUnresolvedRun(steps: readonly ReasoningStep[]): ReasoningStep[] {
  const run: ReasoningStep[] = [];
  let taggedContent: string | undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type === "action") break;
    if (s.type !== "thought") continue;
    if (!isTagged(s)) {
      if (taggedContent?.startsWith(s.content.trim())) {
        run.push(s);
        continue;
      }
      break;
    }
    taggedContent = s.content;
    run.push(s);
  }
  return run.reverse();
}

/**
 * Shaped replies (tagged steps) since the last SUCCESSFUL tool observation —
 * the per-run total that does not need strict consecutiveness. A failed or
 * unknown native call between shaped replies does not reset it, so alternating
 * shaped / failing-native runs still reach the honest terminal (Fix 2).
 */
export function countUnresolvedSinceSuccess(steps: readonly ReasoningStep[]): number {
  let n = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type === "observation" && s.metadata?.observationResult?.success === true) break;
    if (isTagged(s)) n++;
  }
  return n;
}

/** Every shaped-reply thought in `steps`: tagged steps and their preceding untagged twins. */
export function unresolvedThoughtSet(steps: readonly ReasoningStep[]): ReadonlySet<ReasoningStep> {
  const out = new Set<ReasoningStep>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (!isTagged(s)) continue;
    out.add(s);
    for (let j = i - 1; j >= 0; j--) {
      const t = steps[j]!;
      if (t.type !== "thought") continue;
      if (!isTagged(t) && s.content.startsWith(t.content.trim())) out.add(t);
      break;
    }
  }
  return out;
}

/** True when any thought in `steps` is a shaped-reply thought. */
export const hasUnresolvedThoughts = (steps: readonly ReasoningStep[]): boolean => steps.some(isTagged);

/**
 * Last thought that is model prose (not a shaped-reply artifact) — the only
 * kind a fallback may deliver as output. `undefined` when none exists.
 */
export function lastDeliverableThought(steps: readonly ReasoningStep[]): ReasoningStep | undefined {
  const shaped = unresolvedThoughtSet(steps);
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.type === "thought" && !shaped.has(s)) return s;
  }
  return undefined;
}
