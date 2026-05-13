import { loadTrace, type TraceEvent } from "@reactive-agents/trace";
import type {
  Debrief,
  DebriefStep,
  DebriefAssumption,
  DebriefCuratorAction,
  DebriefAlternatives,
} from "./types.js";

/**
 * Build a Debrief from a trace JSONL path. Folds every rationale-bearing event
 * (tool calls, assumptions, curator decisions, alternatives, termination)
 * into a structured timeline.
 *
 * Skips iterations that produced no rationale-bearing activity so the output
 * focuses on decision points, not raw event count.
 */
export async function buildDebrief(tracePath: string): Promise<Debrief> {
  const trace = await loadTrace(tracePath);

  let goal = "";
  let runId = trace.runId;
  const path: DebriefStep[] = [];
  const assumptions: DebriefAssumption[] = [];
  const curatorActions: DebriefCuratorAction[] = [];
  const alternatives: DebriefAlternatives[] = [];
  let termination: Debrief["termination"] = { by: "unknown" };
  let verdict: Debrief["verdict"] | undefined;

  for (const ev of trace.events) {
    switch (ev.kind) {
      case "run-started": {
        runId = ev.runId;
        goal = ev.task;
        break;
      }
      case "run-completed": {
        verdict = {
          status: ev.status,
          tokens: ev.totalTokens,
          durationMs: ev.durationMs,
        };
        break;
      }
      case "tool-call-start": {
        path.push({
          iter: ev.iter,
          action: `tool:${ev.toolName}`,
          ...(ev.rationale ? { rationale: ev.rationale } : {}),
        });
        break;
      }
      case "assumption-recorded": {
        assumptions.push({
          iter: ev.iter,
          assumption: ev.assumption,
          rationale: ev.rationale,
        });
        break;
      }
      case "curator-decision": {
        curatorActions.push({
          iter: ev.iter,
          action: ev.action,
          targetRef: ev.targetRef,
          rationale: ev.rationale,
        });
        break;
      }
      case "alternatives-considered": {
        alternatives.push({
          iter: ev.iter,
          chosen: ev.chosen,
          rejected: ev.alternatives,
        });
        break;
      }
      case "kernel-state-snapshot": {
        if (ev.terminatedBy) {
          termination = {
            by: ev.terminatedBy,
            ...(ev.terminationRationale ? { rationale: ev.terminationRationale } : {}),
          };
        }
        break;
      }
      case "strategy-switched": {
        path.push({
          iter: ev.iter,
          action: `strategy:${ev.from}→${ev.to}`,
          ...(ev.rationale ? { rationale: ev.rationale } : {}),
        });
        break;
      }
      default:
        break;
    }
  }

  return {
    runId,
    goal,
    path,
    assumptions,
    curatorActions,
    alternatives,
    termination,
    ...(verdict ? { verdict } : {}),
  };
}

/**
 * Pure variant for testing — folds an in-memory event list into a Debrief.
 * Identical semantics to buildDebrief() minus the JSONL load.
 */
export function foldDebrief(events: readonly TraceEvent[], runId: string): Debrief {
  let goal = "";
  let actualRunId = runId;
  const path: DebriefStep[] = [];
  const assumptions: DebriefAssumption[] = [];
  const curatorActions: DebriefCuratorAction[] = [];
  const alternatives: DebriefAlternatives[] = [];
  let termination: Debrief["termination"] = { by: "unknown" };
  let verdict: Debrief["verdict"] | undefined;

  for (const ev of events) {
    switch (ev.kind) {
      case "run-started":
        actualRunId = ev.runId;
        goal = ev.task;
        break;
      case "run-completed":
        verdict = { status: ev.status, tokens: ev.totalTokens, durationMs: ev.durationMs };
        break;
      case "tool-call-start":
        path.push({
          iter: ev.iter,
          action: `tool:${ev.toolName}`,
          ...(ev.rationale ? { rationale: ev.rationale } : {}),
        });
        break;
      case "assumption-recorded":
        assumptions.push({ iter: ev.iter, assumption: ev.assumption, rationale: ev.rationale });
        break;
      case "curator-decision":
        curatorActions.push({
          iter: ev.iter,
          action: ev.action,
          targetRef: ev.targetRef,
          rationale: ev.rationale,
        });
        break;
      case "alternatives-considered":
        alternatives.push({ iter: ev.iter, chosen: ev.chosen, rejected: ev.alternatives });
        break;
      case "kernel-state-snapshot":
        if (ev.terminatedBy) {
          termination = {
            by: ev.terminatedBy,
            ...(ev.terminationRationale ? { rationale: ev.terminationRationale } : {}),
          };
        }
        break;
      case "strategy-switched":
        path.push({
          iter: ev.iter,
          action: `strategy:${ev.from}→${ev.to}`,
          ...(ev.rationale ? { rationale: ev.rationale } : {}),
        });
        break;
      default:
        break;
    }
  }

  return {
    runId: actualRunId,
    goal,
    path,
    assumptions,
    curatorActions,
    alternatives,
    termination,
    ...(verdict ? { verdict } : {}),
  };
}
