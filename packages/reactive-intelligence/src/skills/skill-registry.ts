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
        // `allowed-tools` (agentskills.io) is NOT enforced or parsed: it stays a raw
        // string. Skills inform the agent; they never widen or narrow the tool surface.
        if (subKey === "requires") {
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

/** Options for {@link discoverSkills}. */
export type DiscoverSkillsOptions = {
  /**
   * Scan the user-global dirs `~/.agents/skills` and `~/.reactive-agents/skills`
   * (lowest precedence). Default `false`: global skills are opt-in.
   */
  readonly global?: boolean;
  /** When set, `<root>/.<agentId>/skills` is scanned alongside `<root>/.agents/skills`. */
  readonly agentId?: string;
};

/**
 * Ordered list of directories {@link discoverSkills} scans (earliest wins on a
 * name collision). Duplicates (after resolution) are dropped.
 */
export function skillScanPaths(
  root: string,
  paths: readonly string[],
  options: DiscoverSkillsOptions = {},
): string[] {
  const absRoot = path.resolve(root);
  // HOME read per call: Bun's os.homedir() caches the startup value, so a run
  // (or a hermetic test) that rebinds HOME would otherwise scan the wrong dir.
  const home = process.env.HOME || os.homedir();
  const ordered = [
    // Agent-scoped dir first: the more specific source wins (unchanged from before).
    ...(options.agentId ? [path.join(absRoot, `.${options.agentId}`, "skills")] : []),
    path.join(absRoot, ".agents", "skills"),
    ...paths.map((p) => path.resolve(absRoot, p)),
    path.join(absRoot, ".claude", "skills"),
    ...(options.global === true
      ? [
          path.join(home, ".agents", "skills"),
          path.join(home, ".reactive-agents", "skills"),
        ]
      : []),
  ];
  return Array.from(new Set(ordered));
}

/**
 * Discover SKILL.md files (`<dir>/<skill>/SKILL.md`) under an explicit root.
 *
 * Scan order — earlier wins on a name collision:
 *   1. `<root>/.<agentId>/skills` (when `agentId` is set), then `<root>/.agents/skills`
 *   2. `paths`, each resolved against `root` (never cwd); absolute paths are used as-is
 *   3. `<root>/.claude/skills` — Claude Code compatibility, lowest workspace precedence
 *   4. only with `global: true`: `~/.agents/skills`, then `~/.reactive-agents/skills`
 *
 * Learned (SQLite) skills are merged later by the resolver and still win over
 * every filesystem source.
 */
export function discoverSkills(
  root: string,
  paths: readonly string[],
  options: DiscoverSkillsOptions = {},
): SkillDiscoveryResult {
  const scanPaths = skillScanPaths(root, paths, options);

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
