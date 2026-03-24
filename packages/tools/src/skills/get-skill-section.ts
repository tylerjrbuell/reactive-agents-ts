import type { ToolDefinition } from "../types.js";

export const getSkillSectionTool: ToolDefinition = {
  name: "get-skill-section",
  description:
    "Retrieve a specific section from a skill's full instructions. " +
    "Use when a skill is loaded in condensed mode and you need details like examples, steps, or references. " +
    "The result appears in the tool response only — it does NOT expand your base context.",
  parameters: [
    {
      name: "skillName",
      type: "string",
      description: "The skill name to query",
      required: true,
    },
    {
      name: "section",
      type: "string",
      description: 'Section to retrieve: "examples", "steps", "references", "full", or any heading name',
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
 * Parse a markdown document into sections by heading.
 * Returns a map of lowercased heading name → section content.
 */
export function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = body.split("\n");
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentHeading) {
        sections[currentHeading] = currentContent.join("\n").trim();
      }
      currentHeading = headingMatch[1]!.toLowerCase().trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  // Save last section
  if (currentHeading) {
    sections[currentHeading] = currentContent.join("\n").trim();
  }

  return sections;
}

/**
 * Get a specific section from skill instructions.
 * Returns the section content, or "section not found".
 */
export function getSkillSection(fullInstructions: string, section: string): string {
  if (section.toLowerCase() === "full") {
    return fullInstructions;
  }

  const sections = parseSections(fullInstructions);
  const key = section.toLowerCase().trim();

  // Direct match
  if (sections[key]) return sections[key]!;

  // Partial match (e.g., "examples" matches "examples and usage")
  for (const [heading, content] of Object.entries(sections)) {
    if (heading.includes(key) || key.includes(heading)) {
      return content;
    }
  }

  return "section not found";
}
