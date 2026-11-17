/**
 * Agent config panel section registry: id, title, icon and the search keywords
 * "Find a setting" matches. One list drives the panel's jump chips and filter,
 * and the Lab builder's section nav (`BUILDER_NAV`).
 */

/** One AgentConfigPanel section. */
export interface AgentConfigSection {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly keywords: string;
  /**
   * AgentConfig paths this section's controls set (through
   * `cortexParamsToAgentConfig`, where the curated value wins over `rawConfig`).
   * A path covers its sub-paths. "All framework options" hides these so no
   * option has two controls; pinned against the mapping by
   * `server/tests/curated-config-paths.test.ts`.
   */
  readonly configPaths: readonly string[];
}

/** All sections in panel order. */
export const AGENT_CONFIG_SECTIONS: readonly AgentConfigSection[] = [
  {
    id: "inference",
    label: "Model",
    icon: "memory",
    keywords: "inference llm provider model temperature tokens system prompt task context health anthropic openai gemini ollama litellm test routing tier cheapest",
    configPaths: ["name", "provider", "model", "systemPrompt", "temperature", "maxTokens", "numCtx", "thinking", "taskContext", "features.healthCheck", "modelRouting.minTier"],
  },
  {
    id: "persona",
    label: "Persona",
    icon: "face",
    keywords: "role tone traits response style behaviour face",
    configPaths: ["persona.role", "persona.tone", "persona.instructions"],
  },
  {
    id: "strategy",
    label: "Reasoning",
    icon: "psychology",
    keywords: "strategy react plan execute tot tree reflexion adaptive iterations min max verification reflect runtime semantic entropy quality switching harness grounding fabrication rationale",
    configPaths: [
      "reasoning.defaultStrategy", "reasoning.enableStrategySwitching", "reasoning.auditRationale", "reasoning.harness",
      "execution.maxIterations", "execution.minIterations",
      "verificationStep.mode", "features.verification",
      "grounding.mode", "fabricationGuard",
    ],
  },
  {
    id: "variables",
    label: "Variables",
    icon: "data_object",
    keywords: "template variable parameter parameterized run placeholder token mustache enum default required rescan substitution",
    configPaths: [],
  },
  {
    id: "tools",
    label: "Tools",
    icon: "construction",
    keywords: "web search file read write code mcp registry construction shell terminal host execute risk allowlist approval approve deny gate pause",
    // Shell and workspace (split out as its own Lab entry) are Tools fields in the panel.
    // Approvals gate tool calls, so they live here.
    configPaths: ["tools.allowedTools", "tools.disclosure", "tools.terminal", "tools.workspace", "tools.webSearch", "mcpServers", "approvalPolicy"],
  },
  {
    id: "subagents",
    label: "Sub-agents",
    icon: "hub",
    keywords: "local remote a2a url hub delegation delegate researcher spawn dynamic nested recursion depth",
    configPaths: ["agentTools", "dynamicSubAgents"],
  },
  {
    id: "skills",
    label: "Skills",
    icon: "auto_awesome",
    keywords: "living skill.md activate force path directory agentskills auto awesome",
    configPaths: ["skills.paths", "skills.activate", "skills.global"],
  },
  {
    id: "memory",
    label: "Memory",
    icon: "account_tree",
    keywords: "working episodic semantic context synthesis ics account tree debrief documents rag retrieval ingest",
    configPaths: ["memory.tier", "features.memory", "reasoning.synthesis", "documents"],
  },
  {
    id: "guardrails",
    label: "Guardrails",
    icon: "security",
    keywords: "injection pii toxicity security threshold",
    configPaths: ["guardrails.injection", "guardrails.pii", "guardrails.toxicity", "guardrails.customBlocklist"],
  },
  {
    id: "execution",
    label: "Execution",
    icon: "timer",
    keywords: "timeout retry cache checkpoint progress ttl timer durable resume crash budget token cost cap webhooks lifecycle ask question request_user_input interaction",
    // `userInteraction` (the request_user_input rail): "Ask me questions"; durable runs turn it on too.
    configPaths: ["execution.timeoutMs", "execution.retryPolicy", "budget.tokenLimit", "budget.costLimit", "userInteraction"],
  },
  {
    id: "channels",
    label: "Channels",
    icon: "chat",
    keywords: "channels messaging telegram signal webhook bot chat gateway allowlist allow everyone access senders cron schedule queue token credentials",
    // Access control, the inbound queue and cron schedules of a saved gateway agent. The channel
    // list itself is not an AgentConfig path (live adapters; credentials are never in a config).
    configPaths: ["gateway.accessControl", "gateway.queue", "gateway.crons"],
  },
  {
    id: "outputschema",
    label: "Output schema",
    icon: "data_object",
    keywords: "output schema structured json typed object result fields extract object parse degrade throw",
    configPaths: ["outputSchema", "outputSchemaOptions"],
  },
  {
    id: "judgment",
    label: "Judgment",
    icon: "balance",
    keywords: "judgment judge typesafe jev noul score choice calibrated confidence ollama system one nimble clef shadow backend keep alive emulation",
    // `.withJudgment()` has no AgentConfig form (framework gap): an overlay, so no config path.
    configPaths: [],
  },
  { id: "metatools", label: "Meta tools", icon: "wand_stars", keywords: "conductor brief find pulse recall harness suite wand stars", configPaths: ["metaTools"] },
  { id: "reliability", label: "Reliability", icon: "shield", keywords: "fallback provider errors shield backup calibration learned community", configPaths: ["fallbacks", "calibration"] },
  {
    id: "observability",
    label: "Observability",
    icon: "monitoring",
    keywords: "metrics dashboard verbosity monitoring logs",
    // Verbosity also sets `observability.live` and the agent log (`logging`).
    configPaths: ["observability.verbosity", "observability.live", "observability.checklist", "observability.tracing", "logging"],
  },
];

/**
 * AgentConfig paths Cortex sets itself on every build, with no control: the
 * agent id (chat session / saved agent identity), the reasoning kernel (always
 * on) and the kill switch (desk pause / resume / stop). A generic control for
 * them would do nothing.
 */
export const CORTEX_FIXED_CONFIG_PATHS: readonly string[] = ["agentId", "features.reasoning", "features.killSwitch"];

/** Every AgentConfig path a curated section (or Cortex itself) sets. */
export function curatedConfigPaths(): string[] {
  return [...AGENT_CONFIG_SECTIONS.flatMap((s) => s.configPaths), ...CORTEX_FIXED_CONFIG_PATHS];
}

/** Whether `path` is set by a curated control: equal to a curated path or under one. */
export function isCuratedConfigPath(path: string): boolean {
  return curatedConfigPaths().some((p) => path === p || path.startsWith(`${p}.`));
}

/** Sections hidden in the compact panel (chat quick config). */
const COMPACT_HIDDEN = new Set(["variables", "tools", "subagents", "skills", "channels"]);

/** Section ids the panel shows, in order. */
export function activeSectionIds(compact: boolean): string[] {
  const ids = AGENT_CONFIG_SECTIONS.map((s) => s.id);
  return compact ? ids.filter((id) => !COMPACT_HIDDEN.has(id)) : ids;
}

/** Title and keywords of a section (an unknown id falls back to itself). */
export function sectionCopy(id: string): { label: string; keywords: string } {
  const s = AGENT_CONFIG_SECTIONS.find((x) => x.id === id);
  return s ? { label: s.label, keywords: s.keywords } : { label: id, keywords: id };
}

// ── Lab builder section nav (Bench spec section 8, `lab.html`) ──────────

/**
 * Parts the Lab builder shows as their own nav entry although the collapsible
 * panel nests them: the shell and workspace fields (inside Tools) and the
 * generic framework-options renderer (inside Reasoning).
 */
export type BuilderPartId = "shell" | "framework";

/** One entry of the Lab builder's section nav: a title and the panel sections it shows. */
export interface BuilderNavEntry {
  readonly id: string;
  readonly label: string;
  /** Kit icon name (`lib/icons.ts`). */
  readonly icon: "model" | "chat" | "code" | "strategy" | "tool" | "shell" | "agents" | "book" | "folder" | "alert" | "steps" | "goal" | "trace" | "settings";
  /** One line under the section title. */
  readonly description: string;
  /** Panel section ids (`AGENT_CONFIG_SECTIONS`) and builder parts it renders, in order. */
  readonly sections: readonly string[];
  /** Extra words "Find a setting" matches, beyond the member sections' keywords. */
  readonly keywords: string;
}

/**
 * The Lab builder's section nav: the 13 panel sections grouped into entries
 * (Inference is Model, Strategy is Reasoning, Meta tools under Tools), plus
 * Shell and workspace and All framework options
 * as entries of their own. Data, not markup: the nav, the form and "Find a
 * setting" all read this list.
 */
export const BUILDER_NAV: readonly BuilderNavEntry[] = [
  { id: "model", label: "Model", icon: "model", description: "Which model the agent thinks with, how much it may say, and when a cheaper one may answer.", sections: ["inference"], keywords: "inference" },
  { id: "persona", label: "Persona", icon: "chat", description: "Who the agent is and how it sounds.", sections: ["persona"], keywords: "" },
  { id: "variables", label: "Variables", icon: "code", description: "Named values the agent's prompts fill in at run time.", sections: ["variables"], keywords: "variables template placeholders params inputs {{ }}" },
  { id: "reasoning", label: "Reasoning", icon: "strategy", description: "How the agent plans, how many loops it may take, and how it checks its work.", sections: ["strategy"], keywords: "" },
  { id: "tools", label: "Tools", icon: "tool", description: "What the agent can call (built-in tools, MCP servers, meta tools) and which calls wait for your approval.", sections: ["tools", "metatools"], keywords: "disclosure" },
  { id: "shell", label: "Shell and workspace", icon: "shell", description: "Where the agent works and which programs it may run.", sections: ["shell"], keywords: "shell terminal workspace folder directory cwd sandbox allowlist commands git gh host execute" },
  { id: "subagents", label: "Sub-agents", icon: "agents", description: "Agents this one can hand work to: named ones, local or remote, and ones it spawns while it runs.", sections: ["subagents"], keywords: "" },
  { id: "skills", label: "Skills", icon: "book", description: "SKILL.md folders the agent can load while it works.", sections: ["skills"], keywords: "" },
  { id: "memory", label: "Memory", icon: "folder", description: "What the agent remembers within a run and across runs, and the documents it can search.", sections: ["memory"], keywords: "" },
  { id: "guardrails", label: "Guardrails", icon: "alert", description: "Checks on what goes in and comes out: injection, PII and toxicity.", sections: ["guardrails"], keywords: "" },
  { id: "execution", label: "Execution", icon: "steps", description: "How a run is carried out: limits, retries, durable runs, questions to you and webhooks.", sections: ["execution"], keywords: "durable runs" },
  { id: "channels", label: "Channels", icon: "chat", description: "Messaging a saved Gateway process agent answers on (Telegram, Signal, webhook), who may message it, and its schedules.", sections: ["channels"], keywords: "messaging telegram signal webhook bot access control allowlist" },
  { id: "outputschema", label: "Output schema", icon: "goal", description: "The typed object the agent returns: its fields, as a table in the run and the chat.", sections: ["outputschema"], keywords: "structured output json schema typed result" },
  { id: "judgment", label: "Judgment", icon: "goal", description: "The backend that answers typed judgments (TypeSafe Jev, an Ollama System One model, or the agent's own model), and how it is reached.", sections: ["judgment"], keywords: "judge typesafe jev noul score choice calibrated shadow nimble" },
  { id: "reliability", label: "Reliability", icon: "goal", description: "Fallback providers for when a call fails.", sections: ["reliability"], keywords: "" },
  { id: "observability", label: "Observability", icon: "trace", description: "How much the run reports while it works.", sections: ["observability"], keywords: "" },
  { id: "framework", label: "All framework options", icon: "settings", description: "Every builder option the framework exposes, read from its capability manifest.", sections: ["framework"], keywords: "advanced raw config manifest builder options" },
];

/** The nav entry with this id, or the first (Model). */
export function builderNavEntry(id: string): BuilderNavEntry {
  return BUILDER_NAV.find((e) => e.id === id) ?? BUILDER_NAV[0]!;
}

/** The nav entry that shows a panel section (`execution` → `execution`, `metatools` → `tools`), else undefined. */
export function navEntryOfSection(sectionId: string): string | undefined {
  return BUILDER_NAV.find((e) => e.sections.includes(sectionId))?.id;
}

/** Whether a nav entry matches "Find a setting": its title, its words, or a member section's title, keywords or id. */
export function builderNavMatches(entry: BuilderNavEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.label.toLowerCase().includes(q) || entry.id.includes(q) || entry.keywords.includes(q)) return true;
  return entry.sections.some((id) => sectionVisible(id, q, false));
}

/** The nav entries "Find a setting" leaves, in nav order. */
export function filterBuilderNav(query: string): BuilderNavEntry[] {
  return BUILDER_NAV.filter((e) => builderNavMatches(e, query));
}

/** The count a nav entry shows beside its title (Tools: the tools selected, the host shell included), else undefined. */
export function builderNavCount(entryId: string, config: { readonly tools?: readonly string[]; readonly terminalTools?: boolean }): number | undefined {
  if (entryId !== "tools") return undefined;
  const names = new Set(config.tools ?? []);
  if (config.terminalTools) names.add("shell-execute");
  return names.size > 0 ? names.size : undefined;
}

/** Whether a section shows: active in this panel and matching the filter (title, keywords or id). */
export function sectionVisible(id: string, filter: string, compact: boolean): boolean {
  if (!activeSectionIds(compact).includes(id)) return false;
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  const { label, keywords } = sectionCopy(id);
  return label.toLowerCase().includes(q) || keywords.includes(q) || id.includes(q);
}
