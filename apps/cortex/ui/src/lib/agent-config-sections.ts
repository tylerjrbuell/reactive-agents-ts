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
}

/** All sections in panel order. */
export const AGENT_CONFIG_SECTIONS: readonly AgentConfigSection[] = [
  {
    id: "inference",
    label: "Model",
    icon: "memory",
    keywords: "inference llm provider model temperature tokens system prompt task context health anthropic openai gemini ollama litellm test",
  },
  { id: "persona", label: "Persona", icon: "face", keywords: "role tone traits response style behaviour face" },
  {
    id: "strategy",
    label: "Reasoning",
    icon: "psychology",
    keywords: "strategy react plan execute tot tree reflexion adaptive iterations min max verification reflect runtime semantic entropy quality approval approve deny gate commands durable",
  },
  {
    id: "variables",
    label: "Variables",
    icon: "data_object",
    keywords: "template variable parameter parameterized run placeholder token mustache enum default required rescan substitution",
  },
  {
    id: "tools",
    label: "Tools",
    icon: "construction",
    keywords: "web search file read write code mcp registry spawn dynamic sub agent construction shell terminal host execute risk allowlist",
  },
  { id: "subagents", label: "Sub-agents", icon: "hub", keywords: "local remote a2a url hub delegation researcher" },
  { id: "skills", label: "Skills", icon: "auto_awesome", keywords: "living skill.md activate force path directory agentskills auto awesome" },
  { id: "memory", label: "Memory", icon: "account_tree", keywords: "working episodic semantic context synthesis ics account tree" },
  { id: "guardrails", label: "Guardrails", icon: "security", keywords: "injection pii toxicity security threshold" },
  { id: "execution", label: "Execution", icon: "timer", keywords: "timeout retry cache checkpoint progress ttl timer" },
  { id: "metatools", label: "Meta tools", icon: "wand_stars", keywords: "conductor brief find pulse recall harness suite wand stars" },
  { id: "reliability", label: "Reliability", icon: "shield", keywords: "fallback provider errors shield backup" },
  { id: "observability", label: "Observability", icon: "monitoring", keywords: "metrics dashboard verbosity monitoring logs" },
];

/** Sections hidden in the compact panel (chat quick config). */
const COMPACT_HIDDEN = new Set(["variables", "tools", "subagents", "skills"]);

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
  readonly icon: "model" | "chat" | "strategy" | "tool" | "shell" | "agents" | "book" | "folder" | "alert" | "steps" | "goal" | "trace" | "settings";
  /** One line under the section title. */
  readonly description: string;
  /** Panel section ids (`AGENT_CONFIG_SECTIONS`) and builder parts it renders, in order. */
  readonly sections: readonly string[];
  /** Extra words "Find a setting" matches, beyond the member sections' keywords. */
  readonly keywords: string;
}

/**
 * The Lab builder's section nav: the 13 panel sections grouped into entries
 * (Inference is Model, Strategy is Reasoning, Variables sit under Persona,
 * Meta tools under Tools), plus Shell and workspace and All framework options
 * as entries of their own. Data, not markup: the nav, the form and "Find a
 * setting" all read this list.
 */
export const BUILDER_NAV: readonly BuilderNavEntry[] = [
  { id: "model", label: "Model", icon: "model", description: "Which model the agent thinks with, and how much it may say.", sections: ["inference"], keywords: "inference" },
  { id: "persona", label: "Persona", icon: "chat", description: "Who the agent is, how it sounds, and the variables its prompts take.", sections: ["persona", "variables"], keywords: "" },
  { id: "reasoning", label: "Reasoning", icon: "strategy", description: "How the agent plans, how many loops it may take, and how it checks its work.", sections: ["strategy"], keywords: "output schema webhooks durable runs" },
  { id: "tools", label: "Tools", icon: "tool", description: "What the agent can call: built-in tools, MCP servers and the meta tools.", sections: ["tools", "metatools"], keywords: "disclosure" },
  { id: "shell", label: "Shell and workspace", icon: "shell", description: "Where the agent works and which programs it may run.", sections: ["shell"], keywords: "shell terminal workspace folder directory cwd sandbox allowlist commands git gh host execute" },
  { id: "subagents", label: "Sub-agents", icon: "agents", description: "Agents this one can hand work to, local or remote.", sections: ["subagents"], keywords: "" },
  { id: "skills", label: "Skills", icon: "book", description: "SKILL.md folders the agent can load while it works.", sections: ["skills"], keywords: "" },
  { id: "memory", label: "Memory", icon: "folder", description: "What the agent remembers within a run and across runs.", sections: ["memory"], keywords: "" },
  { id: "guardrails", label: "Guardrails", icon: "alert", description: "Checks on what goes in and comes out: injection, PII and toxicity.", sections: ["guardrails"], keywords: "" },
  { id: "execution", label: "Execution", icon: "steps", description: "Timeouts, retries, caching and checkpoints.", sections: ["execution"], keywords: "" },
  { id: "reliability", label: "Reliability", icon: "goal", description: "Fallback providers for when a call fails.", sections: ["reliability"], keywords: "" },
  { id: "observability", label: "Observability", icon: "trace", description: "How much the run reports while it works.", sections: ["observability"], keywords: "" },
  { id: "framework", label: "All framework options", icon: "settings", description: "Every builder option the framework exposes, read from its capability manifest.", sections: ["framework"], keywords: "advanced raw config manifest builder options" },
];

/** The nav entry with this id, or the first (Model). */
export function builderNavEntry(id: string): BuilderNavEntry {
  return BUILDER_NAV.find((e) => e.id === id) ?? BUILDER_NAV[0]!;
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
