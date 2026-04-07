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
  /**
   * Top-level YAML keys from SKILL.md frontmatter (agentskills.io), excluding the nested `metadata:` object.
   * Omitted when the skill was parsed in loose mode without frontmatter.
   */
  readonly declaredFields?: Record<string, unknown>;
};

export type SkillDiscoveryResult = {
  readonly skills: readonly InstalledSkill[];
  readonly collisions: readonly { name: string; kept: string; discarded: string }[];
  readonly warnings: readonly string[];
};

function parseSimpleYamlBlock(yamlBlock: string, filePath: string): Record<string, unknown> | null {
  const parsed: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentObj: Record<string, unknown> | null = null;

  const lines = yamlBlock.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;

    if (line.match(/^ {2,}/) && currentObj !== null && currentKey !== null) {
      const subMatch = line.match(/^ +([^:]+):\s*(.*)$/);
      if (subMatch) {
        const subKey = subMatch[1]!.trim();
        const subVal = subMatch[2]!.trim();
        if (subKey === "requires" || subKey === "allowed-tools") {
          currentObj[subKey] = subVal.split(/\s+/).filter(Boolean);
        } else {
          currentObj[subKey] = subVal;
        }
      }
      continue;
    }

    const topMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (topMatch) {
      const key = topMatch[1]!.trim();
      const val = topMatch[2]!.trim();

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

  if (!parsed["name"] || typeof parsed["name"] !== "string") {
    console.warn(`[SkillRegistry] Missing required field 'name' in ${filePath}`);
    return null;
  }

  return parsed;
}

function buildInstalledSkillFromParsed(
  parsed: Record<string, unknown>,
  body: string,
  filePath: string,
  skillDirForResources: string,
): InstalledSkill {
  const name = parsed["name"] as string;
  const description =
    typeof parsed["description"] === "string" ? parsed["description"] : "";

  if (!description) {
    console.warn(`[SkillRegistry] Missing recommended field 'description' in ${filePath}`);
  }

  const metadata: Record<string, unknown> =
    parsed["metadata"] && typeof parsed["metadata"] === "object"
      ? (parsed["metadata"] as Record<string, unknown>)
      : {};

  const declaredFields: Record<string, unknown> = { ...parsed };
  delete declaredFields["metadata"];

  const resources =
    filePath.startsWith("sqlite:") || skillDirForResources === ""
      ? { scripts: [] as string[], references: [] as string[], assets: [] as string[] }
      : {
          scripts: listDir(path.join(skillDirForResources, "scripts")),
          references: listDir(path.join(skillDirForResources, "references")),
          assets: listDir(path.join(skillDirForResources, "assets")),
        };

  return {
    name,
    description,
    instructions: body.trimStart(),
    metadata,
    filePath,
    resources,
    declaredFields,
  };
}

/**
 * Parse agentskills.io-style SKILL.md content (YAML frontmatter + markdown body).
 * Returns null if frontmatter is missing, invalid, or `name` is missing.
 */
export function parseSKILLmdContent(content: string, filePath: string): InstalledSkill | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return null;
  }

  const yamlBlock = frontmatterMatch[1]!;
  const body = frontmatterMatch[2]!;
  const parsed = parseSimpleYamlBlock(yamlBlock, filePath);
  if (!parsed) return null;

  const skillDir = filePath.startsWith("sqlite:")
    ? ""
    : path.dirname(path.resolve(filePath));

  return buildInstalledSkillFromParsed(parsed, body, filePath, skillDir);
}

/**
 * When content is plain markdown or missing valid open-skill frontmatter, still return a view model
 * (e.g. Cortex SQLite skill rows).
 */
export function parseSkillMarkdownLoose(
  content: string,
  filePath: string,
  fallback: { name: string; description?: string },
): InstalledSkill {
  const strict = parseSKILLmdContent(content, filePath);
  if (strict) return strict;

  return {
    name: fallback.name,
    description: fallback.description ?? "",
    instructions: content.trim(),
    metadata: {},
    filePath,
    resources: { scripts: [], references: [], assets: [] },
  };
}

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

  return parseSKILLmdContent(content, filePath);
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
    path.join(root, `.${agentId}`, "skills"),
    path.join(root, ".agents", "skills"),
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
