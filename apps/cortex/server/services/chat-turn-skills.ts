/**
 * Skills on a chat turn: which skills the turn's run had active and why, and the
 * per-turn pins `/skill <name>` sends.
 *
 * Activity: the run reports its skills on the bus (`AgentStarted.config.skills`,
 * one `SkillActivated` per activation). {@link recordSkillActivity} keeps those per
 * run so the stream path can store them on the turn trace (`trace.skills`, ui-core
 * `RunSkillsView`); ui-core `foldRunSkills` reads them, Cortex does not re-derive.
 * The kernel's `activate-skill` event carries no `taskId` yet, so an event without
 * one counts for the run the session started last (a chat session runs one turn at
 * a time).
 *
 * Per-turn pins: the framework takes run pins on `agent.run/runStream(task,
 * { skills: { activate } })`, but `AgentSession.runStream` / `chat` do not forward
 * them yet. Until they do, a pinned turn runs on an agent built with the pins added
 * to `withSkills({ activate })` ({@link withTurnSkillPins}); the session config is
 * never written, and the agent is dropped after the turn so the next one rebuilds
 * without them.
 */
import type { AgentEvent } from "@reactive-agents/core";
import { foldRunSkills, type RunSkillsView } from "@reactive-agents/ui-core";
import type { SubscribableAgent } from "./chat-ingest.js";
import type { StoredTurnTrace } from "./chat-turn-trace.js";

/** Runs remembered per session; older ones are dropped first. */
const MAX_RUNS = 32;
/** Pins accepted per turn, and their length cap. */
const MAX_TURN_PINS = 16;
const MAX_PIN_CHARS = 200;

/** Skill activity of one chat session's runs. */
export interface SkillActivityLog {
  /** The run's skills view, or `undefined` when it had no skills configured and activated none. */
  readonly skillsOf: (runId: string | undefined) => RunSkillsView | undefined;
}

/** Subscribe `agent`; returns the log and its unsubscribe. */
export async function recordSkillActivity(
  agent: SubscribableAgent,
): Promise<{ readonly log: SkillActivityLog; readonly unsubscribe: () => void }> {
  const runs = new Map<string, AgentEvent[]>();
  let current: string | undefined;
  const unsubscribe = await agent.subscribe((event: AgentEvent) => {
    if (event._tag === "AgentStarted") {
      // A sub-agent's start is not the turn's run.
      if (event.parentAgentId !== undefined) return;
      current = event.taskId;
      // Bootstrap activations can arrive first (same taskId): keep them.
      runs.set(event.taskId, [event, ...(runs.get(event.taskId) ?? [])]);
      if (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
      return;
    }
    if (event._tag !== "SkillActivated") return;
    // Bootstrap activations are published before AgentStarted, with the run's taskId.
    const runId = event.taskId ?? current;
    if (runId === undefined) return;
    const list = runs.get(runId) ?? [];
    list.push(event);
    runs.set(runId, list);
  });
  return {
    log: {
      skillsOf: (runId) => {
        if (runId === undefined) return undefined;
        const events = runs.get(runId);
        // AgentStarted is kept first, so the fold reads the record before the activations.
        return events ? foldRunSkills(events) : undefined;
      },
    },
    unsubscribe,
  };
}

/** Attach the run's skills to a turn trace; the trace unchanged when the run had none. */
export function withTurnSkills(
  trace: StoredTurnTrace | undefined,
  skills: RunSkillsView | undefined,
): StoredTurnTrace | undefined {
  if (!skills) return trace;
  return { ...(trace ?? { reasoningSteps: [], toolCalls: [] }), skills };
}

/** Clean a request's per-turn pins: strings, trimmed, deduped, capped. */
export function turnSkillPinsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (name === "" || name.length > MAX_PIN_CHARS || out.some((n) => n.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
    if (out.length >= MAX_TURN_PINS) break;
  }
  return out;
}

/**
 * The session config with `pins` added to `skills.activate` for one turn (see the
 * module note). Returns `cfg` itself when there are no pins.
 */
export function withTurnSkillPins(cfg: Record<string, unknown>, pins: readonly string[]): Record<string, unknown> {
  if (pins.length === 0) return cfg;
  const cur = cfg.skills && typeof cfg.skills === "object" && !Array.isArray(cfg.skills) ? (cfg.skills as Record<string, unknown>) : {};
  const activate = Array.isArray(cur.activate) ? cur.activate.filter((x): x is string => typeof x === "string") : [];
  const merged = [...activate];
  for (const p of pins) if (!merged.some((n) => n.toLowerCase() === p.toLowerCase())) merged.push(p);
  return { ...cfg, skills: { ...cur, paths: Array.isArray(cur.paths) ? cur.paths : [], activate: merged } };
}
