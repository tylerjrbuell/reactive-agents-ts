// File: src/strategies/planning/fanout-split.ts
/**
 * Split a plan step whose whole output feeds several different files.
 *
 * bonsai H3 (2026-11-05, h3-plan-only): the planner wrote one analysis step and
 * three file writes, each with `content: "{{from_step:s2}}"`. The analysis step
 * then got one "your entire reply becomes the content of X" line per file
 * (step-consumers.ts), which contradict each other, so the first file got all
 * three files' text (bonsai 5/5 failures, qwen 1/1). One reply cannot be three
 * different files. The fix is structural: one producer copy per target file, so
 * each copy has exactly one destination.
 *
 * Called once, right after the plan is generated (plan-execute and blueprint),
 * before any repair step appends synthetic steps. Pure; the Effect wrapper
 * applies the split to the plan and emits one
 * `guard-fired{guard:"plan-fanout-split"}` per split producer.
 */
import { Effect } from "effect";
import { fromStepRe } from "../../assembly/ref-grammar.js";
import { emitGuardFired } from "../../kernel/utils/diagnostics.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import { stepConsumers } from "./step-consumers.js";

/** The guard-fired key for a fan-out split. */
export const PLAN_FANOUT_SPLIT_GUARD = "plan-fanout-split";

/** One split producer, in the ids of the returned plan. */
export interface FanOutSplit {
  /** The producer's id in the input plan. */
  readonly producerId: string;
  /** One producer step per target, in target order (the first is the original step). */
  readonly producerIds: readonly string[];
  /** The file each producer step writes, aligned with `producerIds`. */
  readonly targets: readonly string[];
}

/** The plan's steps after splitting, and every split made (empty: unchanged). */
export interface FanOutSplitResult {
  readonly steps: PlanStep[];
  readonly splits: readonly FanOutSplit[];
}

/** Every step id a step references (dependsOn, from_step in args and instruction). */
function referencedIds(step: PlanStep): readonly string[] {
  const ids = [...(step.dependsOn ?? [])];
  const texts = [step.instruction, ...Object.values(step.toolArgs ?? {}).filter((v): v is string => typeof v === "string")];
  for (const text of texts) for (const m of text.matchAll(fromStepRe())) ids.push(m[1]!);
  return ids;
}

/** Replace the step id inside every from_step reference in `text`. */
function remapText(text: string, map: (id: string) => string): string {
  return text.replace(fromStepRe(), (match: string, id: string) => `{{from_step:${map(id)}${match.slice(`{{from_step:${id}`.length)}`);
}

/** The step with every reference (dependsOn, from_step) passed through `map`. */
function remapStep(step: PlanStep, map: (id: string) => string): PlanStep {
  return {
    ...step,
    instruction: remapText(step.instruction, map),
    ...(step.dependsOn !== undefined ? { dependsOn: step.dependsOn.map(map) } : {}),
    ...(step.toolArgs !== undefined
      ? { toolArgs: Object.fromEntries(Object.entries(step.toolArgs).map(([k, v]) => [k, typeof v === "string" ? remapText(v, map) : v])) }
      : {}),
  };
}

/** Whole-output consumers of `producer` grouped by target file, in plan order. */
function consumersByTarget(steps: readonly PlanStep[], producer: PlanStep): ReadonlyMap<string, ReadonlySet<string>> {
  const groups = new Map<string, Set<string>>();
  for (const c of stepConsumers(steps, producer.id)) {
    if (!c.whole || c.target === undefined) continue;
    const group = groups.get(c.target) ?? new Set<string>();
    group.add(c.consumerId);
    groups.set(c.target, group);
  }
  return groups;
}

/**
 * Give each non-tool step whose whole output becomes ≥2 different files one
 * copy per file. Copies keep the producer's instruction and dependencies and
 * sit right after it; each consumer's references to the producer move to its
 * file's copy (the first file keeps the original). Partial consumers and
 * context-only references stay on the original. Steps are then renumbered
 * `s1..sN` in order, with every reference rewritten. Tool-call producers are
 * never copied (that would repeat the call). A plan with a reference to a
 * missing step is returned unchanged (renumbering could bind it to a real step).
 */
export function splitFanOutProducers(steps: readonly PlanStep[]): FanOutSplitResult {
  const known = new Set(steps.map((s) => s.id));
  if (steps.some((s) => referencedIds(s).some((id) => !known.has(id)))) return { steps: [...steps], splits: [] };

  type Entry = { readonly step: PlanStep; readonly key: string };
  const entries: Entry[] = [];
  /** consumer id → (producer id → key of the copy it reads). */
  const overrides = new Map<string, Map<string, string>>();
  const pending: { readonly producerId: string; readonly keys: readonly string[]; readonly targets: readonly string[] }[] = [];

  for (const step of steps) {
    const groups = step.type === "tool_call" ? new Map<string, ReadonlySet<string>>() : consumersByTarget(steps, step);
    if (groups.size < 2) {
      entries.push({ step, key: step.id });
      continue;
    }
    const targets = [...groups.keys()];
    const keys = targets.map((_, i) => (i === 0 ? step.id : `${step.id}#${i}`));
    targets.forEach((target, i) => {
      entries.push({ step: { ...step, title: `${step.title} (${target})` }, key: keys[i]! });
      for (const consumerId of groups.get(target)!) {
        const map = overrides.get(consumerId) ?? new Map<string, string>();
        map.set(step.id, keys[i]!);
        overrides.set(consumerId, map);
      }
    });
    pending.push({ producerId: step.id, keys, targets });
  }
  if (pending.length === 0) return { steps: [...steps], splits: [] };

  const newId = new Map(entries.map((e, i) => [e.key, `s${i + 1}`]));
  const out = entries.map((e, i) => {
    const own = overrides.get(e.key);
    const map = (id: string): string => newId.get(own?.get(id) ?? id) ?? id;
    return { ...remapStep(e.step, map), id: `s${i + 1}`, seq: i + 1 };
  });
  const splits = pending.map((p) => ({
    producerId: p.producerId,
    producerIds: p.keys.map((k) => newId.get(k)!),
    targets: p.targets,
  }));
  return { steps: out, splits };
}

/**
 * Apply {@link splitFanOutProducers} to `plan` in place and emit one
 * `guard-fired{guard:"plan-fanout-split"}` per split producer.
 */
export const applyFanOutSplit = (plan: Plan, taskId: string): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const { steps, splits } = splitFanOutProducers(plan.steps);
    if (splits.length === 0) return;
    plan.steps = steps;
    for (const split of splits) {
      yield* emitGuardFired({
        taskId,
        iteration: 0,
        guard: PLAN_FANOUT_SPLIT_GUARD,
        outcome: "redirect",
        reason: `step ${split.producerId}'s whole output fed ${split.targets.length} files; split into ${split.producerIds.join(", ")}, one per file`,
        metadata: { producerId: split.producerId, producerIds: split.producerIds, targets: split.targets },
      });
    }
  });
