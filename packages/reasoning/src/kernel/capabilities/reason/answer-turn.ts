/**
 * Think phase — the exit gate's ANSWER TURN (owner decision 2026-11-10,
 * Cortex run 01M73FK911EPZWMJAGSFZ7FPNB).
 *
 * The harness decides WHEN the model must answer; the model always writes the
 * answer. When the exit gate denies a soft exit once and every outstanding item
 * is answer-shaped (no required tool or write target left), it stamps the
 * denial with `answerTurnAt` = the run's LLM-call count (`exit-gate.ts`). The
 * next think call is the answer turn: it ships with NO tools, so a small model
 * cannot spend it gathering again. Exactly one call: once it is made,
 * `llmCalls` moves past `answerTurnAt` and tools are offered again.
 *
 * Derived from the step record (the gate's own `exitGate` record): no
 * kernel-state field, no extra write path.
 */
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import type { KernelState } from "../../state/kernel-state.js";
import type { PendingGuidance } from "../../state/guidance-channel.js";
import { lastExitGateRecord } from "../../loop/exit-gate.js";

/** True when this think call is the exit gate's answer turn (tools withheld for it). */
export function answerTurnPending(state: KernelState): boolean {
  const record = lastExitGateRecord(state.steps);
  return (
    record?.gateDecision === "deny-once" &&
    record.answerTurnAt !== undefined &&
    record.answerTurnAt === (state.llmCalls ?? 0)
  );
}

/**
 * The guidance an answer turn renders: the gate's own hint (what to write) plus
 * the facts about the last turn. Every kind that could steer toward a tool call
 * is dropped — the call has no tools (the N1 lesson: never "call X" with zero
 * schemas).
 */
export function guidanceForAnswerTurn(g: PendingGuidance): PendingGuidance {
  return {
    ...(g.qualityGateHint ? { qualityGateHint: g.qualityGateHint } : {}),
    ...(g.environmentUpdate ? { environmentUpdate: g.environmentUpdate } : {}),
    ...(g.pendingSignals ? { pendingSignals: g.pendingSignals } : {}),
  };
}

/**
 * Trace event for the answer turn (emitted by think.ts). Trace-only: the
 * guidance it rides is the gate's own `qualityGateHint`; this records the wire
 * fact that the call shipped without tools.
 */
export const emitAnswerTurn = (state: KernelState) =>
  emitHarnessSignalInjected({
    taskId: state.taskId,
    iteration: state.iteration,
    signalKind: "redirect",
    origin: "exit-gate-answer-turn",
    content: "answer turn: think call made with tools withheld",
    metadata: { kind: "answer-turn", llmCalls: state.llmCalls ?? 0 },
  });
