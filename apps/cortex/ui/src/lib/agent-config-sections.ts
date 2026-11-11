/**
 * Agent config panel section registry: id, title, icon and the search keywords the
 * "Filter sections" box matches. One list drives the panel's section nav and filter.
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
    label: "Inference",
    icon: "memory",
    keywords: "llm provider model temperature tokens system prompt task context health anthropic openai gemini ollama litellm test",
  },
  { id: "persona", label: "Persona", icon: "face", keywords: "role tone traits response style behaviour face" },
  {
    id: "strategy",
    label: "Reasoning",
    icon: "psychology",
    keywords: "strategy react plan execute tot tree reflexion adaptive iterations min max verification reflect runtime semantic entropy quality",
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

/** Whether a section shows: active in this panel and matching the filter (title, keywords or id). */
export function sectionVisible(id: string, filter: string, compact: boolean): boolean {
  if (!activeSectionIds(compact).includes(id)) return false;
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  const { label, keywords } = sectionCopy(id);
  return label.toLowerCase().includes(q) || keywords.includes(q) || id.includes(q);
}
