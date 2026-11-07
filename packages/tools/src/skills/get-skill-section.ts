/**
 * Deprecated markdown section helpers, left from the removed
 * `get-skill-section` tool. The tool itself is gone: bundled skill content is
 * read with `activate-skill({ name, file })` (skills spec §4, §11 item 10).
 *
 * These two pure helpers stay exported only because
 * `packages/runtime/src/__tests__/living-intelligence-integration.test.ts`
 * imports `getSkillSection` and that package typechecks its tests. Delete
 * this file when that test goes (skills spec step 4).
 */

/**
 * Parse a markdown document into sections by heading.
 * Returns a map of lowercased heading name → section content.
 *
 * @deprecated The `get-skill-section` tool was removed; use `activate-skill({ name, file })`.
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
 *
 * @deprecated The `get-skill-section` tool was removed; use `activate-skill({ name, file })`.
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
