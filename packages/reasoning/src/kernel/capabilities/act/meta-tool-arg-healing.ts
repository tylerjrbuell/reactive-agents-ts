/**
 * act/meta-tool-arg-healing.ts — closed-alias argument healing for the inline
 * `brief` and `pulse` meta-tools ("healing built into tool design").
 *
 * Models drift on enum values and parameter names. These pure helpers rewrite
 * the drift with CLOSED alias tables (never fuzzy-widening into a value the tool
 * did not list) and report each rewrite as a `HealingAction`, which the caller
 * puts on the action step's `healingApplied` metadata. Unknown values pass
 * through unchanged, so `brief` still falls back to the compact overview.
 */
import { healEnumArg, healParamNames, type HealingAction } from "@reactive-agents/tools";

/** Canonical `brief` sections (mirrors the tool definition's `section` enum). */
const BRIEF_SECTIONS = ["tools", "documents", "skills", "memory", "recall", "signal", "all"] as const;

const BRIEF_SECTION_ALIASES: Readonly<Record<string, string>> = {
  tool: "tools",
  doc: "documents",
  docs: "documents",
  document: "documents",
  skill: "skills",
  mem: "memory",
  recall_keys: "recall",
  "recall-keys": "recall",
  keys: "recall",
  scratchpad: "recall",
  signals: "signal",
  entropy: "signal",
  everything: "all",
  full: "all",
};

const BRIEF_PARAM_ALIASES = { section: ["topic", "part", "sections"] } as const;
const PULSE_PARAM_ALIASES = { question: ["query", "q", "prompt", "ask"] } as const;

export interface HealedBriefArgs {
  readonly section: string | undefined;
  readonly healing: readonly HealingAction[];
}

export interface HealedPulseArgs {
  readonly question: string | undefined;
  readonly healing: readonly HealingAction[];
}

const renamed = (healed: readonly string[]): HealingAction[] =>
  healed.map((h) => {
    const [from = h, to = h] = h.split("->");
    return { stage: "param-name", from, to };
  });

/** Heal `brief` args: param-name drift for `section`, then its enum value. */
export function healBriefArgs(args: Readonly<Record<string, unknown>> | undefined): HealedBriefArgs {
  const { args: named, healed } = healParamNames(args ?? {}, BRIEF_PARAM_ALIASES);
  const healing = renamed(healed);
  const raw = named.section;
  if (typeof raw !== "string") return { section: raw as undefined, healing };
  const v = healEnumArg(raw, BRIEF_SECTIONS, BRIEF_SECTION_ALIASES);
  if (v.healedFrom !== undefined) healing.push({ stage: "param-name", from: v.healedFrom, to: v.value });
  return { section: v.value, healing };
}

/** Heal `pulse` args: param-name drift for `question` (free text, no enum). */
export function healPulseArgs(args: Readonly<Record<string, unknown>> | undefined): HealedPulseArgs {
  const { args: named, healed } = healParamNames(args ?? {}, PULSE_PARAM_ALIASES);
  const q = named.question;
  return { question: typeof q === "string" ? q : undefined, healing: renamed(healed) };
}
