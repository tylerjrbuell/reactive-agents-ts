import type { ControllerDecision, ControllerEvalParams } from "../types.js";

/**
 * Evaluate whether the agent should switch reasoning strategy.
 * Fires when entropy trajectory has been "flat" for N consecutive iterations
 * AND the behavioral loop score is high (> 0.45), indicating the current
 * strategy is stuck in an unproductive loop.
 */
export function evaluateStrategySwitch(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "switch-strategy" }) | null {
  const { entropyHistory, config, strategy, iteration } = params;
  // A switch the run cannot make becomes a switching_exhausted exit in the
  // kernel, so do not propose one (see ControllerEvalParams.switchingAvailable).
  if (params.switchingAvailable === false) return null;
  const flatCount = config.flatIterationsBeforeSwitch ?? 3;
  // 0.45 rather than 0.7: local models accumulate behavioral entropy more slowly
  // (fewer repeated tool calls before giving up), so a lower bar catches real loops.
  const LOOP_SCORE_BAR = 0.45;

  // Need enough history and must be past early exploration phase.
  // Switching strategy in the first 3 iterations is premature — the model
  // hasn't had runway to demonstrate the current strategy is actually stuck.
  if (entropyHistory.length < flatCount) return null;
  if (iteration < 3) return null;

  // Single-authority rule: the kernel's redirect is the trigger, entropy is the
  // escalation. Without kernel corroboration this evaluator would fire one
  // iteration behind the kernel and stack a second, unrelated piece of guidance
  // into the same context window (observed: run 01M2GM1SZ0FVXDD3TNN0F9FZ5A,
  // kernel redirect at iter 2, entropy switch at iter 3).
  //
  // Scope note: `redirectsIssued` only increments on unresolved TOOL failure
  // recovery — this guard, and therefore this whole evaluator, is unreachable
  // for thought-only loops, or for tool calls that succeed but return
  // unproductive results.
  if ((params.kernelLoopSignal?.redirectsIssued ?? 0) < 1) return null;

  // Check last flatCount entries all have shape "flat"
  const recent = entropyHistory.slice(-flatCount);
  const allFlat = recent.every((e) => e.trajectory.shape === "flat");
  if (!allFlat) return null;

  // Require elevated entropy — flat at 0.15 means the model finished and is
  // just stalling, not that it's stuck in a bad loop. Only switch strategy
  // when the model is stuck at a meaningfully high entropy level.
  const flatEntropy = recent[recent.length - 1]!.composite;
  if (flatEntropy < 0.35) return null;

  // Check behavioral loop score exceeds threshold.
  if (params.behavioralLoopScore <= LOOP_SCORE_BAR) return null;

  // Simple alternation: suggest the other strategy
  const to =
    strategy === "plan-execute-reflect" ? "reactive" : "plan-execute-reflect";

  // Scale confidence by headroom above the 0.45 bar: a score of 0.46 is a weak
  // signal, 0.9 is a strong one. Consumers need to tell these apart — the
  // decision alone does not say how sure the controller was.
  const confidence = Math.max(
    0,
    Math.min(1, (params.behavioralLoopScore - LOOP_SCORE_BAR) / (1 - LOOP_SCORE_BAR)),
  );

  return {
    decision: "switch-strategy",
    from: strategy,
    to,
    confidence,
    reason: `Entropy flat for ${flatCount} iterations with high loop score (${params.behavioralLoopScore.toFixed(2)}), switching from ${strategy} to ${to}`,
  };
}
