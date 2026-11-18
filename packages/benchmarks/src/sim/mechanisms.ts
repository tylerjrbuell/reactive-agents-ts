/**
 * Phase Z: the harness mechanisms the matrix sweeps. Each maps a name to the
 * `HarnessConfig` that turns it ON (off = the field absent: the default). Flag
 * names are the real `HarnessConfig` fields (packages/reasoning/src/harness-config.ts);
 * the config rides `buildRunEnvelope({ harness })`, never an env flag.
 */
import type { HarnessConfig } from "@reactive-agents/reasoning";

/** One sweepable mechanism. */
export interface Mechanism {
  readonly name: string;
  /** The harness config that turns it on. */
  readonly on: HarnessConfig;
  /** Why this one is in the set. */
  readonly note: string;
}

export const MECHANISMS: readonly Mechanism[] = [
  {
    name: "leanFinalTurn",
    on: { leanFinalTurn: true },
    note: "tool-less final turn once tool work is settled (S6 HURTS finding)",
  },
  {
    name: "parallelToolHint",
    on: { parallelToolHint: "always" },
    note: "system-prompt line inviting batched independent calls (local tier only)",
  },
  {
    name: "actOrAnswer",
    on: { actOrAnswer: true },
    note: "one forced-call retry after a no-call turn while tool work is outstanding",
  },
  {
    name: "actOrAnswerProactive",
    on: { actOrAnswer: "proactive" },
    note: "forced call on the first request when tool work is outstanding",
  },
  {
    name: "inputCoverage",
    on: { inputCoverage: true },
    note: "exit gate: each listed input must be read by its own call",
  },
  {
    name: "writeCoverage",
    on: { writeCoverage: true },
    note: "exit gate: each listed edit target must be written",
  },
  {
    name: "budgetAnswerTurn",
    on: { budgetAnswerTurn: true },
    note: "last allowed think call ships without tools when only the answer is missing",
  },
  {
    name: "wrapUpReserve",
    on: { wrapUpReserve: true },
    note: "last allowed think call ships without tools on a seeded checklist run",
  },
];

/**
 * Every swept mechanism explicitly OFF. An absent field falls back to the
 * `RA_*` environment variable (explicit config > env > default), so an "off" arm
 * that merely omits the flag would depend on the caller's shell. Both arms start
 * from this and the "on" arm overlays one mechanism.
 */
export const ALL_OFF: HarnessConfig = {
  leanFinalTurn: false,
  parallelToolHint: false,
  actOrAnswer: false,
  inputCoverage: false,
  writeCoverage: false,
  budgetAnswerTurn: false,
  wrapUpReserve: false,
};

/** The harness config of the off arm (`undefined`) or of one mechanism's on arm. */
export function armConfig(mechanism?: Mechanism): HarnessConfig {
  return mechanism === undefined ? ALL_OFF : { ...ALL_OFF, ...mechanism.on };
}

/** Look a mechanism up by name; `undefined` when unknown. */
export function findMechanism(name: string): Mechanism | undefined {
  return MECHANISMS.find((m) => m.name === name);
}
