import type { ToolDefinition } from "../types.js";

export interface BriefInput {
  section: string | undefined;
  availableTools: readonly { name: string; description: string; parameters: readonly unknown[] }[];
  indexedDocuments: readonly { source: string; chunkCount: number; format: string }[];
  availableSkills: readonly { name: string; purpose: string }[];
  memoryBootstrap: { semanticLines: number; episodicEntries: number };
  recallKeys: readonly string[];
  tokens: number;
  tokenBudget: number;
  entropy: { composite: number; shape: string; momentum: number } | undefined;
  controllerDecisionLog: readonly string[];
}

export const briefTool: ToolDefinition = {
  name: "brief",
  description:
    "Full situational briefing. Zero args for compact overview. " +
    "Drill with section: 'tools', 'documents', 'skills', 'memory', 'recall', 'signal', 'all'. " +
    "Call this at the start of complex tasks to understand your full environment.",
  parameters: [
    {
      name: "section",
      type: "string",
      description:
        "Drill into a section: tools | documents | skills | memory | recall | signal | all. Omit for compact overview.",
      required: false,
    },
  ],
  returnType: "string",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
  category: "data",
};

export function computeEntropyGrade(composite: number | undefined): string {
  if (composite === undefined) return "unknown";
  if (composite <= 0.3) return "A";
  if (composite <= 0.45) return "B";
  if (composite <= 0.65) return "C";
  if (composite <= 0.75) return "D";
  return "F";
}

export function buildBriefResponse(input: BriefInput): string {
  const { section } = input;
  if (section === "documents") return formatDocuments(input);
  if (section === "skills") return formatSkills(input);
  if (section === "tools") return formatTools(input);
  if (section === "memory") return formatMemory(input);
  if (section === "recall") return formatRecall(input);
  if (section === "signal") return formatSignal(input);
  if (section === "all") {
    return [formatTools(input), formatDocuments(input), formatSkills(input),
            formatMemory(input), formatRecall(input), formatSignal(input)].join("\n\n");
  }
  return formatCompact(input);
}

function formatCompact(input: BriefInput): string {
  const { availableTools, indexedDocuments, availableSkills, memoryBootstrap, recallKeys, tokens, tokenBudget, entropy } = input;
  const used = Math.round((tokens / tokenBudget) * 100);
  const bar = "█".repeat(Math.round(used / 10)) + "░".repeat(10 - Math.round(used / 10));
  const pressure = used >= 90 ? "critical" : used >= 75 ? "high" : used >= 50 ? "moderate" : "low";
  const remaining = tokenBudget - tokens;
  const lines: string[] = [
    `tools: ${availableTools.length} available [${[...new Set(availableTools.map(t => t.name.split("-")[0]))].join(", ")}]`,
    indexedDocuments.length > 0
      ? `documents: ${indexedDocuments.map(d => `${d.source.split("/").pop()} (${d.chunkCount} chunks)`).join(" · ")}`
      : "documents: none indexed",
    availableSkills.length > 0
      ? `skills: ${availableSkills.length} available [${availableSkills.map(s => s.name).join(", ")}]`
      : "skills: none loaded",
    `memory: ${memoryBootstrap.semanticLines} semantic · ${memoryBootstrap.episodicEntries} episodic`,
    recallKeys.length > 0
      ? `recall: ${recallKeys.length} keys [${recallKeys.slice(0, 5).join(", ")}]`
      : "recall: empty",
    `context: ${bar} ${used}% · ${pressure} pressure · ${remaining} tokens remaining`,
  ];
  if (entropy) {
    const grade = computeEntropyGrade(entropy.composite);
    const icon = grade === "A" || grade === "B" ? "✅" : grade === "C" ? "⚠" : "🔴";
    lines.push(`signal: ${icon} ${entropy.shape} trajectory · Grade ${grade} · entropy ${entropy.composite.toFixed(2)}`);
  }
  return lines.join("\n");
}

function formatTools(input: BriefInput): string {
  const lines = ["=== Tools ==="];
  for (const t of input.availableTools) lines.push(`• ${t.name}: ${t.description.slice(0, 100)}`);
  return lines.join("\n");
}

function formatDocuments(input: BriefInput): string {
  if (input.indexedDocuments.length === 0) return "=== Documents ===\nNo documents indexed.";
  const lines = ["=== Documents ==="];
  for (const d of input.indexedDocuments) lines.push(`• ${d.source} — ${d.chunkCount} chunks (${d.format})`);
  return lines.join("\n");
}

function formatSkills(input: BriefInput): string {
  if (input.availableSkills.length === 0) return "=== Skills ===\nNo skills loaded.";
  const lines = ["=== Skills ==="];
  for (const s of input.availableSkills) lines.push(`• ${s.name}: ${s.purpose}`);
  return lines.join("\n");
}

function formatMemory(input: BriefInput): string {
  return ["=== Memory ===",
    `Semantic: ${input.memoryBootstrap.semanticLines} lines bootstrapped`,
    `Episodic: ${input.memoryBootstrap.episodicEntries} recent entries`].join("\n");
}

function formatRecall(input: BriefInput): string {
  if (input.recallKeys.length === 0) return "=== Recall ===\nEmpty.";
  const lines = ["=== Recall ==="];
  for (const k of input.recallKeys) lines.push(`• ${k} (${k.startsWith("_") ? "auto" : "agent"})`);
  return lines.join("\n");
}

function formatSignal(input: BriefInput): string {
  if (!input.entropy) return "=== Signal ===\nReactive intelligence not available — enable .withReactiveIntelligence().";
  const { entropy, controllerDecisionLog } = input;
  const grade = computeEntropyGrade(entropy.composite);
  const lines = ["=== Signal ===",
    `Grade: ${grade}  Composite: ${entropy.composite.toFixed(3)}  Shape: ${entropy.shape}  Momentum: ${entropy.momentum.toFixed(3)}`];
  if (controllerDecisionLog.length > 0) {
    lines.push("Controller decisions this run:");
    for (const d of controllerDecisionLog) lines.push(`  • ${d}`);
  }
  return lines.join("\n");
}
