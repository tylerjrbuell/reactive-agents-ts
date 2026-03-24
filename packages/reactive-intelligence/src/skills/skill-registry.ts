import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type InstalledSkill = {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly metadata: Record<string, unknown>;
  readonly filePath: string;
  readonly resources: { scripts: string[]; references: string[]; assets: string[] };
};

export type SkillDiscoveryResult = {
  readonly skills: readonly InstalledSkill[];
  readonly collisions: readonly { name: string; kept: string; discarded: string }[];
  readonly warnings: readonly string[];
};

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Uses a simple regex-based parser (no external dependency).
 * Returns null if the file can't be parsed.
 */
export function parseSKILLmd(filePath: string): InstalledSkill | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  // Extract frontmatter: must start with --- at top
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return null;
  }

  const yamlBlock = frontmatterMatch[1]!;
  const body = frontmatterMatch[2]!;

  // Parse simple YAML manually
  const parsed: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentObj: Record<string, unknown> | null = null;

  const lines = yamlBlock.split("\n");
  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === "") continue;

    // Check for indented sub-key (metadata fields)
    if (line.match(/^ {2,}/) && currentObj !== null && currentKey !== null) {
      const subMatch = line.match(/^ +([^:]+):\s*(.*)$/);
      if (subMatch) {
        const subKey = subMatch[1]!.trim();
        const subVal = subMatch[2]!.trim();
        // Split space-separated arrays for requires and allowed-tools
        if (subKey === "requires" || subKey === "allowed-tools") {
          currentObj[subKey] = subVal.split(/\s+/).filter(Boolean);
        } else {
          currentObj[subKey] = subVal;
        }
      }
      continue;
    }

    // Top-level key: value
    const topMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (topMatch) {
      const key = topMatch[1]!.trim();
      const val = topMatch[2]!.trim();

      // If value is empty, this might be an object key
      if (val === "") {
        currentObj = {};
        currentKey = key;
        parsed[key] = currentObj;
      } else {
        currentKey = key;
        currentObj = null;
        parsed[key] = val;
      }
    }
  }

  // Validate required field: name
  if (!parsed["name"] || typeof parsed["name"] !== "string") {
    console.warn(`[SkillRegistry] Missing required field 'name' in ${filePath}`);
    return null;
  }

  const name = parsed["name"] as string;
  const description =
    typeof parsed["description"] === "string" ? parsed["description"] : "";

  if (!description) {
    console.warn(`[SkillRegistry] Missing recommended field 'description' in ${filePath}`);
  }

  // Extract metadata
  const metadata: Record<string, unknown> =
    parsed["metadata"] && typeof parsed["metadata"] === "object"
      ? (parsed["metadata"] as Record<string, unknown>)
      : {};

  // Scan sibling resource directories
  const skillDir = path.dirname(filePath);
  const resources = {
    scripts: listDir(path.join(skillDir, "scripts")),
    references: listDir(path.join(skillDir, "references")),
    assets: listDir(path.join(skillDir, "assets")),
  };

  return {
    name,
    description,
    instructions: body.trimStart(),
    metadata,
    filePath,
    resources,
  };
}

function listDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  try {
    return fs
      .readdirSync(dirPath)
      .filter((f) => fs.statSync(path.join(dirPath, f)).isFile());
  } catch {
    return [];
  }
}

/**
 * Discover SKILL.md files from standard paths.
 * Returns discovered skills with collision resolution.
 */
export function discoverSkills(
  customPaths: readonly string[],
  agentId: string,
  projectRoot?: string,
): SkillDiscoveryResult {
  const root = projectRoot ?? ".";

  const scanPaths = [
    ...customPaths,
    path.join(root, ".agents", "skills"),
    path.join(root, `.${agentId}`, "skills"),
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".reactive-agents", "skills"),
  ];

  const skills: InstalledSkill[] = [];
  const collisions: { name: string; kept: string; discarded: string }[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>(); // name → filePath

  for (const scanPath of scanPaths) {
    if (!fs.existsSync(scanPath)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(scanPath, { withFileTypes: true });
    } catch {
      warnings.push(`[SkillRegistry] Cannot read directory: ${scanPath}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(scanPath, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      const skill = parseSKILLmd(skillMdPath);
      if (!skill) {
        warnings.push(`[SkillRegistry] Failed to parse ${skillMdPath}`);
        continue;
      }

      if (seen.has(skill.name)) {
        const kept = seen.get(skill.name)!;
        collisions.push({ name: skill.name, kept, discarded: skill.filePath });
        warnings.push(
          `[SkillRegistry] Collision: skill '${skill.name}' from ${skill.filePath} discarded in favor of ${kept}`,
        );
        continue;
      }

      seen.set(skill.name, skill.filePath);
      skills.push(skill);
    }
  }

  return { skills, collisions, warnings };
}
