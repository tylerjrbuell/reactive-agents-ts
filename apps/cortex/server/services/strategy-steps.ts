/**
 * Live strategy steps for a chat turn. A reasoning strategy labels its work with a
 * `kernelPass` (`reflexion:critique-2`, `plan-execute:step-3:done`, ...) on its
 * `ReasoningStepCompleted` events. {@link recordStrategySteps} subscribes the chat agent and
 * queues one ui-core `StepEvent` each time the pass changes, plus one for every tree-of-thought
 * node and for any step that carries detail (code, sandbox output, a critique, a node). The
 * chat stream drains the queue into the turn's SSE events, so the UI draws the strategy's live
 * card from the same events a reload replays. Cortex does not interpret phases: ui-core
 * (`strategy-phases.ts`) owns the label grammar and the fold.
 *
 * Richer payload fields (`node`, `code`, `stdout`, `critique`) are read defensively from the
 * event and are simply absent until the framework reports them.
 */
import type { AgentEvent } from "@reactive-agents/core";
import { totNodeOfThought, totNodeOfWire, type StepEvent, type TotNode } from "@reactive-agents/ui-core";
import type { SubscribableAgent } from "./chat-ingest.js";

/** Steps kept when nobody drains (a run with no consumer); older ones are dropped first. */
const MAX_QUEUED = 500;

const asRecord = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** What a step's `structured` payload (core `ReasoningStepData`) adds to its `StepEvent`; unknown kinds add nothing. */
export interface StepDetail {
  readonly node?: TotNode;
  readonly path?: readonly string[];
  readonly code?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly verify?: { readonly verdict: string; readonly summary: string };
  readonly critique?: string;
  readonly accepted?: boolean;
}

/**
 * Detail from a step's `structured` payload, read defensively (a `kind` this code does not know, or no
 * payload at all, adds nothing). A tree-of-thought explore step with no payload falls back to the node
 * its narration states (`[TOT d=1] score=0.80: ...`); `index` numbers those.
 */
export function stepDetailOf(structured: unknown, exploreThought: string | undefined, index: number): StepDetail {
  const r = asRecord(structured);
  switch (r.kind) {
    case "tot-node": {
      const node = totNodeOfWire(r);
      return node ? { node } : {};
    }
    case "tot-path":
      return Array.isArray(r.nodeIds) && r.nodeIds.length > 0 && r.nodeIds.every((i) => typeof i === "string") ? { path: r.nodeIds as string[] } : {};
    case "code-action": {
      const v = asRecord(r.verify);
      return {
        ...(str(r.code) !== undefined ? { code: str(r.code)! } : {}),
        ...(str(r.stdout) !== undefined ? { stdout: str(r.stdout)! } : {}),
        ...(str(r.stderr) !== undefined ? { stderr: str(r.stderr)! } : {}),
        ...(str(v.verdict) !== undefined ? { verify: { verdict: str(v.verdict)!, summary: typeof v.summary === "string" ? v.summary : "" } } : {}),
      };
    }
    case "reflexion":
      return { ...(str(r.critique) !== undefined ? { critique: str(r.critique)! } : {}), ...(typeof r.accepted === "boolean" ? { accepted: r.accepted } : {}) };
    default: {
      const node = exploreThought ? totNodeOfThought(exploreThought, index) : undefined;
      return node ? { node } : {};
    }
  }
}

/** The queue of one chat session's strategy steps. */
export interface StrategyStepLog {
  /** Start a turn: drop queued steps and forget which run to follow. */
  readonly beginTurn: () => void;
  /** Steps queued since the last drain, oldest first. */
  readonly drain: () => StepEvent[];
}

/** Subscribe `agent`; returns the log and its unsubscribe. Follows the first run that reports a step after `beginTurn`. */
export async function recordStrategySteps(
  agent: SubscribableAgent,
): Promise<{ readonly log: StrategyStepLog; readonly unsubscribe: () => void }> {
  let queue: StepEvent[] = [];
  let followed: string | undefined;
  let lastPass: string | undefined;
  let tot = 0;
  const unsubscribe = await agent.subscribe((event: AgentEvent) => {
    if (event._tag !== "ReasoningStepCompleted") return;
    const pass = event.kernelPass;
    if (!pass) return;
    followed ??= event.taskId;
    if (event.taskId !== followed) return;
    const detail = stepDetailOf(asRecord(event).structured, pass.endsWith(":explore") ? event.thought : undefined, tot);
    if (detail.node?.id.startsWith("thought-")) tot += 1;
    if (pass === lastPass && Object.keys(detail).length === 0) return;
    lastPass = pass;
    queue.push({ _tag: "StepEvent", step: { kind: "strategy-step", pass, ...detail } });
    if (queue.length > MAX_QUEUED) queue = queue.slice(queue.length - MAX_QUEUED);
  });
  return {
    log: {
      beginTurn: () => {
        queue = [];
        followed = undefined;
        lastPass = undefined;
        tot = 0;
      },
      drain: () => {
        const out = queue;
        queue = [];
        return out;
      },
    },
    unsubscribe,
  };
}
