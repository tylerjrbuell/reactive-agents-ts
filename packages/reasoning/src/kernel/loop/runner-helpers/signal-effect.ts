/**
 * signal-effect.ts — deterministic classifier for the signal consumption edge.
 *
 * Pure: no Effect, no LLM, no I/O. Given a signal's target and the steps
 * produced after it was rendered, returns how the model observably responded.
 * See Task 4 of wiki/Planning/Implementation-Plans/2026-10-25-signal-consumption-edge.md.
 */
import type { ReasoningStep } from "../../../types/index.js";
import type { SignalTarget } from "../../state/signal-ledger.js";

export type SignalEffectResponse =
  | "remediated"
  | "ignored"
  | "contradicted"
  | "ambiguous";

export interface SignalEffectResult {
  readonly response: SignalEffectResponse;
  readonly observedTool?: string;
  readonly detail?: string;
}

/** Last tool name observed in the step list (the most recent act). */
function lastObservedTool(steps: readonly ReasoningStep[]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.type !== "observation") continue;
    const r = (s.metadata?.observationResult as { readonly toolName?: string } | undefined);
    if (r?.toolName) return r.toolName;
  }
  return undefined;
}

/** Whether the last observation's tool+args equal the denied payload. */
function lastObservationText(steps: readonly ReasoningStep[]): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.type !== "observation") continue;
    const r = (s.metadata?.observationResult as { readonly displayText?: string } | undefined);
    return (r?.displayText ?? s.content ?? "").toString();
  }
  return "";
}

export function classifySignalEffect(
  target: SignalTarget | { readonly synthesize?: true } | undefined,
  steps: readonly ReasoningStep[],
): SignalEffectResult {
  const observedTool = lastObservedTool(steps);
  const policy = (target as SignalTarget | undefined)?.policy ?? "other";
  const tool = (target as SignalTarget | undefined)?.tool;

  if (steps.length === 0) {
    return { response: "ambiguous", detail: "no act after render" };
  }

  // synthesize / completion-gap: remediated only if the model actually called
  // final-answer after the steer (a bare thought is not synthesis — every pass
  // emits one, so counting it classified every steer as remediated).
  if (policy === "synthesize") {
    const answered = steps.some(
      (s) => s.type === "action" && (s.metadata?.toolCall as { readonly name?: string } | undefined)?.name === "final-answer",
    );
    return answered
      ? { response: "remediated", observedTool, detail: "final-answer called after steer" }
      : { response: "ignored", observedTool, detail: "no final-answer after steer" };
  }

  // required-tool: remediated if the required tool was called.
  if (policy === "required-tool") {
    if (tool && observedTool === tool) {
      return { response: "remediated", observedTool, detail: "required tool called" };
    }
    return { response: "ignored", observedTool, detail: "required tool not called" };
  }

  // denied-tool-retry: remediated if the denied tool was retried with changed
  // args (args text differs from the denied payload); contradicted if the
  // exact same call repeated; ignored if a different tool was called.
  if (policy === "denied-tool-retry") {
    if (!tool) return { response: "ambiguous", observedTool, detail: "no target tool" };
    if (observedTool === tool) {
      const text = lastObservationText(steps);
      // crude: if the observation still looks like a denial, it's a contradicted repeat
      if (/blocked|denied|not in the allowed/i.test(text)) {
        return { response: "contradicted", observedTool, detail: "denied call repeated unchanged" };
      }
      return { response: "remediated", observedTool, detail: "denied tool retried with changed args" };
    }
    if (observedTool === undefined) {
      return { response: "ambiguous", detail: "no act after render" };
    }
    return { response: "ignored", observedTool, detail: "different tool called" };
  }

  // alternate-tool: remediated if the named alternate was called.
  if (policy === "alternate-tool") {
    if (tool && observedTool === tool) {
      return { response: "remediated", observedTool, detail: "alternate tool called" };
    }
    if (observedTool === undefined) {
      return { response: "ambiguous", detail: "no act after render" };
    }
    return { response: "ignored", observedTool, detail: "alternate not called" };
  }

  return { response: "ambiguous", observedTool, detail: "unclassified signal" };
}
