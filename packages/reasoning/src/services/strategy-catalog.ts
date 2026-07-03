/**
 * Authoritative, machine-readable description of every reasoning strategy.
 * SINGLE SOURCE consumed by getCapabilityManifest() (packages/runtime). The
 * registry-equality guard in strategy-catalog.test.ts keeps this in lockstep
 * with StrategyRegistry registrations (strategy-registry.ts) — adding a strategy
 * to the registry without cataloguing it here fails the build.
 */
export interface StrategyCatalogEntry {
  /** Canonical registry key. */
  readonly name: string;
  /** Alternate registry keys that resolve to the same implementation. */
  readonly aliases: string[];
  /** Human-facing label for UI. */
  readonly label: string;
  readonly description: string;
  /** True for multi-phase strategies (UI grouping hint). */
  readonly multiStep: boolean;
}

export const STRATEGY_CATALOG: readonly StrategyCatalogEntry[] = [
  {
    name: "reactive",
    aliases: ["react"],
    label: "ReAct",
    multiStep: false,
    description: "Reason-act loop: think, call a tool, observe, repeat until done.",
  },
  {
    name: "reflexion",
    aliases: [],
    label: "Reflexion",
    multiStep: true,
    description: "ReAct plus self-reflection between attempts to correct course.",
  },
  {
    name: "plan-execute-reflect",
    aliases: [],
    label: "Plan-Execute-Reflect",
    multiStep: true,
    description: "Plan up front, execute steps, reflect and re-plan as needed.",
  },
  {
    name: "tree-of-thought",
    aliases: [],
    label: "Tree of Thought",
    multiStep: true,
    description: "Branch multiple reasoning paths and select the best.",
  },
  {
    name: "adaptive",
    aliases: [],
    label: "Adaptive",
    multiStep: true,
    description: "Selects and switches strategy based on task signals.",
  },
  {
    name: "direct",
    aliases: [],
    label: "Direct",
    multiStep: false,
    description: "Single-shot answer with no tool loop — cheapest path.",
  },
  {
    name: "code-action",
    aliases: [],
    label: "Code Action",
    multiStep: false,
    description: "LLM writes an IIFE run in a Worker sandbox instead of tool calls.",
  },
  {
    name: "blueprint",
    aliases: ["rewoo"],
    label: "Blueprint (ReWOO)",
    multiStep: true,
    description:
      "Plan → verify → execute (0-LLM, parallel) → solve. Cheap for decomposable, tool-heavy domains.",
  },
];
