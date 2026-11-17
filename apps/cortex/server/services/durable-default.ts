/**
 * Durable runs are ON by default in Cortex (owner decision 2026-11-17): a Stop, a
 * Pause or a crash must leave a run the person can Continue, so by default nobody
 * loses progress. The framework's own default stays off; this module is the one
 * place Cortex turns it on, for the chat, desk-run and gateway build paths alike.
 *
 * Rule: an explicit `durableRuns.enabled: false` is honoured (and is what the
 * Builder's Execution switch and the chat `/durable off` write); anything else,
 * including a stored config with no `durableRuns` key at all, builds durable.
 * `dir` and `checkpointEvery` ride along as set.
 */
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";

type DurableRunsParam = NonNullable<BuildCortexAgentParams["durableRuns"]>;

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** True unless the config opts out with a literal `durableRuns.enabled: false`. */
export const durableRunsEnabled = (raw: Readonly<Record<string, unknown>>): boolean => record(raw.durableRuns)?.enabled !== false;

/**
 * The durable setting an agent is BUILT with, or `undefined` when the config turned it off.
 * `eligible: false` (a tools-off chat: no tool calls, so nothing to resume) builds none.
 */
export function effectiveDurableRuns(
  raw: Readonly<Record<string, unknown>>,
  opts: { readonly eligible?: boolean } = {},
): DurableRunsParam | undefined {
  if (opts.eligible === false || !durableRunsEnabled(raw)) return undefined;
  const dr = record(raw.durableRuns);
  const dir = typeof dr?.dir === "string" && dr.dir.trim() !== "" ? dr.dir.trim() : undefined;
  const every = typeof dr?.checkpointEvery === "number" ? dr.checkpointEvery : undefined;
  return { enabled: true, ...(dir ? { dir } : {}), ...(every !== undefined ? { checkpointEvery: every } : {}) };
}
