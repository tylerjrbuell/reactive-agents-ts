/**
 * Lab Builder rules: the builder's config shape, the ad-hoc launch action menu,
 * Edit & Rerun prefill from a run snapshot, and loading a saved agent's config.
 */
import { type AgentConfig, type CortexAgentToolConfig, defaultConfig } from "./types/agent-config.js";
import { formatRelativeTime } from "@reactive-agents/ui-core";
import { approvalPolicyFrom } from "./approval-policy.js";

/** The Builder's config: AgentConfig plus the builder-only blocks it always carries. */
export type BuilderAgentConfig = AgentConfig & {
  maxTokens: number;
  timeout: number;
  retryPolicy: { enabled: boolean; maxRetries: number; backoffMs: number };
  fallbacks: { enabled: boolean; providers: string[]; errorThreshold: number };
  metaTools: { enabled: boolean; brief: boolean; find: boolean; pulse: boolean; recall: boolean; harnessSkill: boolean };
  observabilityVerbosity: "off" | "minimal" | "normal" | "verbose";
  mcpServerIds: string[];
  agentTools: CortexAgentToolConfig[];
  dynamicSubAgents: { enabled: boolean; maxIterations: number };
};

/** Base config for Builder / forms: static defaults + Cortex Settings default provider/model. */
export function builderDefaults(s: { defaultProvider: string; defaultModel: string }): BuilderAgentConfig {
  const base = defaultConfig() as BuilderAgentConfig;
  return {
    ...base,
    provider: s.defaultProvider,
    model: s.defaultModel,
  };
}

/** What the ad-hoc launch button does. */
export type BuilderAdHocAction = "run" | "save" | "save-run";

/** The ad-hoc action menu rows. */
export const BUILDER_ADHOC_ACTIONS: { id: BuilderAdHocAction; label: string; hint: string }[] = [
  { id: "run", label: "Run without saving", hint: "One-off run; nothing is stored under Saved agents." },
  { id: "save", label: "Save", hint: "Store the agent without starting a run." },
  { id: "save-run", label: "Save and run", hint: "Store the agent and start its first run." },
];

/** One row of the launch panel's config summary. */
export interface LaunchSummaryRow {
  readonly label: string;
  readonly value: string;
}

/**
 * The launch panel's summary of what will run (Bench `lab.html`): model,
 * strategy (its display name when known), tools selected (the host shell
 * counts) and the workspace folder.
 */
export function launchSummaryOf(
  config: Pick<AgentConfig, "provider" | "model" | "strategy" | "tools" | "terminalTools" | "workspace">,
  strategyLabel?: string,
): readonly LaunchSummaryRow[] {
  const tools = new Set(config.tools);
  if (config.terminalTools) tools.add("shell-execute");
  return [
    { label: "Model", value: [config.provider, config.model?.trim() || "default model"].filter(Boolean).join(" / ") },
    { label: "Strategy", value: strategyLabel?.trim() || config.strategy },
    { label: "Tools", value: tools.size === 0 ? "None" : String(tools.size) },
    { label: "Workspace", value: config.workspace?.trim() || "None" },
  ];
}

/** The example agent "Load example" puts in the Builder, over the current defaults. */
export function exampleBuilderConfig(defaults: BuilderAgentConfig): BuilderAgentConfig {
  return {
    ...defaults,
    agentName: "my-research-agent",
    systemPrompt: "You are a thorough research assistant. Always cite sources.",
    strategy: "plan-execute-reflect",
    tools: ["web-search", "file-write"],
    memory: { ...defaults.memory, working: true, episodic: true, semantic: false },
  };
}

/**
 * An imported agent config JSON (the panel's or Lab's Export) loaded over the
 * defaults, nested blocks merged; null when the text is not a JSON object.
 */
export function importBuilderConfig(defaults: BuilderAgentConfig, text: string): BuilderAgentConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return builderConfigFromAgent(defaults, parsed as BuilderAgentConfig);
}

/** Inputs the ad-hoc primary button reads. */
export interface AdHocButtonState {
  readonly action: BuilderAdHocAction;
  readonly busy: boolean;
  readonly prompt: string;
  readonly name: string;
}

/** The ad-hoc primary button is disabled while busy or when its action lacks a prompt / name. */
export function adHocPrimaryDisabled(s: AdHocButtonState): boolean {
  if (s.busy) return true;
  switch (s.action) {
    case "run":
      return !s.prompt.trim();
    case "save":
      return !s.name.trim();
    case "save-run":
      return !s.name.trim() || !s.prompt.trim();
    default:
      return true;
  }
}

/** Tooltip on the Save and run button when the task is empty. */
export function adHocPrimaryTitle(s: AdHocButtonState): string | undefined {
  if (s.action !== "save-run") return undefined;
  if (!s.prompt.trim()) return "Add a task: it is stored on the agent and used for the first run.";
  return undefined;
}

/** Friendly schedule presets → cron expressions. */
export const SCHEDULE_PRESETS = [
  { label: "Every minute",    cron: "* * * * *"    },
  { label: "Every 5 minutes", cron: "*/5 * * * *"  },
  { label: "Every 15 minutes",cron: "*/15 * * * *" },
  { label: "Every hour",      cron: "0 * * * *"    },
  { label: "Every day 9am",   cron: "0 9 * * *"    },
  { label: "Every Mon 9am",   cron: "0 9 * * MON"  },
  { label: "Every weekday 9am",cron:"0 9 * * 1-5"  },
  { label: "First of month",  cron: "0 9 1 * *"    },
];

// Keys whose LaunchParams (server) shape matches BuilderAgentConfig (UI) 1:1,
// so they can be copied straight from a run snapshot into the builder. Nested
// fields that diverge between the two shapes (durableRuns, grounding, skills,
// guardrails, persona, agentTools, taskContext, dynamicSubAgents) are
// intentionally omitted — they keep the builder defaults.
export const SNAPSHOT_PREFILL_KEYS = [
  "prompt", "provider", "model", "temperature", "maxTokens", "numCtx",
  "strategy", "maxIterations", "minIterations", "systemPrompt",
  "strategySwitching", "auditRationale", "runtimeVerification", "terminalTools",
  "terminalShellAdditionalCommands", "terminalShellAllowedCommands",
  "verificationStep", "observabilityVerbosity", "additionalToolNames",
  "healthCheck", "tools", "modelRouting", "budget", "metaTools", "fallbacks",
  "retryPolicy", "memory", "rawConfig",
] as const;

/** Builder config prefilled from a run's launch snapshot, merged OVER the current config. */
export function prefillFromSnapshot(current: BuilderAgentConfig, snapshot: Record<string, unknown>): BuilderAgentConfig {
  const patch: Record<string, unknown> = {};
  for (const key of SNAPSHOT_PREFILL_KEYS) {
    if (snapshot[key] !== undefined && snapshot[key] !== null) patch[key] = snapshot[key];
  }
  // The approval gate: the snapshot's server shape (or an old durableRuns one) → the builder shape.
  if (snapshot.approvalPolicy !== undefined || snapshot.durableRuns !== undefined) {
    patch.approvalPolicy = approvalPolicyFrom(snapshot);
  }
  // Merge OVER current config so omitted / newly-added fields keep defaults.
  return { ...current, ...patch } as BuilderAgentConfig;
}

/** A saved agent's config loaded into the Builder: nested blocks merged over the defaults. */
export function builderConfigFromAgent(defaults: BuilderAgentConfig, sourceConfig: BuilderAgentConfig): BuilderAgentConfig {
  return {
    ...defaults,
    ...sourceConfig,
    memory: { ...defaults.memory, ...sourceConfig.memory },
    guardrails: { ...defaults.guardrails, ...sourceConfig.guardrails },
    persona: { ...defaults.persona, ...sourceConfig.persona },
    retryPolicy: { ...defaults.retryPolicy, ...sourceConfig.retryPolicy },
    metaTools: { ...defaults.metaTools, ...sourceConfig.metaTools },
    fallbacks: {
      ...defaults.fallbacks,
      ...sourceConfig.fallbacks,
      providers: [...(sourceConfig.fallbacks?.providers ?? defaults.fallbacks.providers)],
    },
    mcpServerIds: [...(sourceConfig.mcpServerIds ?? defaults.mcpServerIds)],
    agentTools: [...(sourceConfig.agentTools ?? defaults.agentTools)],
    dynamicSubAgents: {
      ...defaults.dynamicSubAgents,
      ...sourceConfig.dynamicSubAgents,
    },
    taskContext: { ...defaults.taskContext, ...(sourceConfig.taskContext ?? {}) },
    healthCheck: sourceConfig.healthCheck ?? defaults.healthCheck,
    // Stored configs carry the approval gate in the server shape (or the old durableRuns one).
    durableRuns: { enabled: sourceConfig.durableRuns?.enabled === true },
    approvalPolicy: approvalPolicyFrom(sourceConfig as unknown as Record<string, unknown>),
    skills: {
      paths: [...(sourceConfig.skills?.paths ?? defaults.skills.paths)],
      ...(sourceConfig.skills?.activate?.length
        ? { activate: [...sourceConfig.skills.activate] }
        : {}),
    },
  };
}

/** "never", or ui-core `formatRelativeTime` ("just now", "5 minutes ago", "2 hours ago"). */
export function relativeTime(ts?: number, now: number = Date.now()): string {
  return ts ? formatRelativeTime(ts, now) : "never";
}
