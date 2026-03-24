import type { ToolDefinition } from "../types.js";

export const activateSkillTool: ToolDefinition = {
  name: "activate-skill",
  description:
    "Activate a skill by name, injecting its full instructions into your context. " +
    "Use this when you need detailed guidance for a specific task pattern. " +
    "Available skills are listed in the <available_skills> catalog in your system prompt.",
  parameters: [
    {
      name: "name",
      type: "string",
      description: "The skill name to activate (from the available_skills catalog)",
      required: true,
    },
  ],
  returnType: "string",
  riskLevel: "low",
  timeoutMs: 2_000,
  requiresApproval: false,
  source: "function",
};

/**
 * Build the <skill_content> XML wrapper for an activated skill.
 */
export function buildSkillContentXml(params: {
  name: string;
  version: number;
  source: string;
  instructions: string;
  resources?: { scripts: string[]; references: string[] };
}): string {
  const lines: string[] = [];
  lines.push(`<skill_content name="${params.name}" version="${params.version}" source="${params.source}">`);
  lines.push("");
  lines.push(params.instructions);
  lines.push("");
  if (params.resources && (params.resources.scripts.length > 0 || params.resources.references.length > 0)) {
    lines.push(`<skill_resources>`);
    for (const s of params.resources.scripts) {
      lines.push(`  <file>scripts/${s}</file>`);
    }
    for (const r of params.resources.references) {
      lines.push(`  <file>references/${r}</file>`);
    }
    lines.push(`</skill_resources>`);
  }
  lines.push("</skill_content>");
  return lines.join("\n");
}
