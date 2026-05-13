import type {
  SkillRecord,
  SkillSource,
  SkillConfidence,
  SkillEvolutionMode,
  SkillFragmentConfig,
} from "@reactive-agents/core";

const METADATA_FENCE_RE = /```json\s*\n([\s\S]*?)\n```/;

type MetadataShape = {
  id: string;
  name: string;
  description: string;
  agentId: string;
  source: SkillSource;
  version: number;
  config: SkillFragmentConfig;
  evolutionMode: SkillEvolutionMode;
  confidence: SkillConfidence;
  successRate: number;
  useCount: number;
  refinementCount: number;
  taskCategories: string[];
  modelAffinities: string[];
  base: string | null;
  avgPostActivationEntropyDelta: number;
  avgConvergenceIteration: number;
  convergenceSpeedTrend: number[];
  conflictsWith: string[];
  lastActivatedAt: string | null;
  lastRefinedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const exportSkillToMarkdown = (skill: SkillRecord): string => {
  const metadata: MetadataShape = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    agentId: skill.agentId,
    source: skill.source,
    version: skill.version,
    config: skill.config,
    evolutionMode: skill.evolutionMode,
    confidence: skill.confidence,
    successRate: skill.successRate,
    useCount: skill.useCount,
    refinementCount: skill.refinementCount,
    taskCategories: [...skill.taskCategories],
    modelAffinities: [...skill.modelAffinities],
    base: skill.base,
    avgPostActivationEntropyDelta: skill.avgPostActivationEntropyDelta,
    avgConvergenceIteration: skill.avgConvergenceIteration,
    convergenceSpeedTrend: [...skill.convergenceSpeedTrend],
    conflictsWith: [...skill.conflictsWith],
    lastActivatedAt: skill.lastActivatedAt?.toISOString() ?? null,
    lastRefinedAt: skill.lastRefinedAt?.toISOString() ?? null,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };

  const successPct = (skill.successRate * 100).toFixed(1);
  const badge = `> Source: ${skill.source} | Confidence: ${skill.confidence} | Version: ${skill.version} | Success: ${successPct}% (${skill.useCount} uses)`;

  const sections: string[] = [
    `# Skill: ${skill.name}`,
    "",
    badge,
    "",
    skill.description ? `${skill.description}\n` : "",
    "## Metadata",
    "",
    "```json",
    JSON.stringify(metadata, null, 2),
    "```",
    "",
    "## Instructions",
    "",
    skill.instructions,
  ];

  if (skill.contentVariants.summary) {
    sections.push("", "## Summary", "", skill.contentVariants.summary);
  }

  if (skill.contentVariants.condensed) {
    sections.push("", "## Condensed", "", skill.contentVariants.condensed);
  }

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
};

const extractSection = (markdown: string, heading: string): string | null => {
  const re = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n*$)`, "i");
  const match = markdown.match(re);
  if (!match) return null;
  return match[1]!.trim();
};

export type ImportOverrides = {
  /** New agent owner for the imported skill. */
  agentId?: string;
  /** Pass "regenerate" to mint a fresh id; pass a string to use that id verbatim. */
  id?: string | "regenerate";
};

const newId = (): string => `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const importSkillFromMarkdown = (
  markdown: string,
  overrides: ImportOverrides = {},
): SkillRecord => {
  const fenceMatch = markdown.match(METADATA_FENCE_RE);
  if (!fenceMatch) {
    throw new Error("skill-portability: missing ```json metadata block");
  }

  let metadata: MetadataShape;
  try {
    metadata = JSON.parse(fenceMatch[1]!) as MetadataShape;
  } catch (e) {
    throw new Error(`skill-portability: malformed JSON metadata — ${(e as Error).message}`);
  }

  // Strip metadata fence so we can scan section headings without false matches.
  const body = markdown.replace(METADATA_FENCE_RE, "");

  const instructionsBody = extractSection(body, "Instructions") ?? metadata.description;
  const summaryBody = extractSection(body, "Summary");
  const condensedBody = extractSection(body, "Condensed");

  const id =
    overrides.id === "regenerate"
      ? newId()
      : overrides.id ?? metadata.id;

  const agentId = overrides.agentId ?? metadata.agentId;

  return {
    id,
    name: metadata.name,
    description: metadata.description,
    agentId,
    source: metadata.source,
    instructions: instructionsBody,
    version: metadata.version,
    versionHistory: [],
    config: metadata.config,
    evolutionMode: metadata.evolutionMode,
    confidence: metadata.confidence,
    successRate: metadata.successRate,
    useCount: metadata.useCount,
    refinementCount: metadata.refinementCount,
    taskCategories: metadata.taskCategories,
    modelAffinities: metadata.modelAffinities,
    base: metadata.base,
    avgPostActivationEntropyDelta: metadata.avgPostActivationEntropyDelta,
    avgConvergenceIteration: metadata.avgConvergenceIteration,
    convergenceSpeedTrend: metadata.convergenceSpeedTrend,
    conflictsWith: metadata.conflictsWith,
    lastActivatedAt: metadata.lastActivatedAt ? new Date(metadata.lastActivatedAt) : null,
    lastRefinedAt: metadata.lastRefinedAt ? new Date(metadata.lastRefinedAt) : null,
    createdAt: new Date(metadata.createdAt),
    updatedAt: new Date(metadata.updatedAt),
    contentVariants: {
      full: instructionsBody,
      summary: summaryBody,
      condensed: condensedBody,
    },
  };
};
