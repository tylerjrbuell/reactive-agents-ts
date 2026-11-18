// File: src/gate/options.ts — the ONE place `LiftGateOptions` is built.
//
// Audit 01 D7: `run.ts` passed `tasks` (long-horizon classification) and
// `isTokenFreeTier` to the gate, `rax eval gate` passed neither, so the same
// report could receive different verdicts depending on the entry point (local
// tiers cost-bound, long-horizon tasks scored short on the CLI path). Both
// entry points now call `gateOptionsFor`.
import { LONG_HORIZON_TASKS } from "../tasks/long-horizon.js";
import type { LiftGateOptions } from "./types.js";

/** A model tier as the session declared it. */
export interface GateModel {
  readonly id: string;
  readonly provider: string;
}

/**
 * Models recorded on a session report (additive field written by `runSession`)
 * so a later `rax eval gate --report` can tell local (token-free) tiers from
 * paid ones without the session definition at hand.
 */
export interface ReportModels {
  readonly models?: ReadonlyArray<GateModel>;
}

/** Narrow the optional `models` field of an archived report (any shape, e.g. hand-written adapters). */
export function modelsOfReport(report: unknown): readonly GateModel[] {
  if (typeof report !== "object" || report === null || !("models" in report)) return [];
  const raw: unknown = report.models;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m: unknown): GateModel[] =>
    typeof m === "object" &&
    m !== null &&
    "id" in m &&
    "provider" in m &&
    typeof m.id === "string" &&
    typeof m.provider === "string"
      ? [{ id: m.id, provider: m.provider }]
      : [],
  );
}

/**
 * The gate options both entry points use:
 * - `tasks`: the long-horizon descriptors, so `horizon:long` tasks are judged
 *   on cost-per-verified-deliverable and not the short token-overhead rule.
 * - `isTokenFreeTier`: ollama tiers (and any id in `extraTokenFreeTiers`) are
 *   token-free: the cost leg is reported, never binding (owner ruling 2026-11-06).
 */
export function gateOptionsFor(
  models: readonly GateModel[],
  extraTokenFreeTiers: readonly string[] = [],
): LiftGateOptions {
  const tokenFree = new Set([
    ...models.filter((m) => m.provider === "ollama").map((m) => m.id),
    ...extraTokenFreeTiers,
  ]);
  return {
    // Only the long-horizon tags matter for class routing; untagged tasks are
    // judged under the short-class (token-overhead) rule.
    tasks: LONG_HORIZON_TASKS.map((t) => ({ id: t.id, tags: [...(t.tags ?? [])] })),
    isTokenFreeTier: (tier) => tokenFree.has(tier),
  };
}
