import * as fs from "node:fs";
import * as path from "node:path";
import { parseSKILLmd } from "@reactive-agents/reactive-intelligence";
import {
  absoluteSkillDirectoryPaths,
  getCortexAppRoot,
} from "./skill-directories.js";

export type FilesystemSkillSummary = {
  readonly source: "filesystem";
  /** Path to SKILL.md, POSIX relative to `process.cwd()`. */
  readonly relPath: string;
  readonly skillDir: string;
  readonly name: string;
  readonly description: string;
};

function toPosixRel(fromCwd: string): string {
  return fromCwd.split(path.sep).join("/");
}

/**
 * Lists every `SKILL.md` under known living-skill roots (see {@link discoverSkillDirectoryPaths}).
 * De-duplicates by relative file path.
 */
/** Stable API path for `GET /api/skills/file` when cwd is not the skill’s base directory. */
function relativizeSkillMdForApi(mdAbs: string): string {
  const cwd = process.cwd();
  const pack = getCortexAppRoot();
  const rc = path.relative(cwd, mdAbs);
  if (rc && !rc.startsWith("..") && !path.isAbsolute(rc)) {
    return toPosixRel(rc);
  }
  const rp = path.relative(pack, mdAbs);
  if (rp && !rp.startsWith("..") && !path.isAbsolute(rp)) {
    return toPosixRel(rp);
  }
  return toPosixRel(mdAbs);
}

function isUnderSomeSkillRoot(fileAbs: string): boolean {
  const normFile = path.normalize(fileAbs);
  for (const root of absoluteSkillDirectoryPaths()) {
    const rel = path.relative(root, normFile);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

export function listFilesystemSkillSummaries(): FilesystemSkillSummary[] {
  const cwd = process.cwd();
  const items: FilesystemSkillSummary[] = [];
  const seenRel = new Set<string>();

  for (const rootAbs of absoluteSkillDirectoryPaths()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(rootAbs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const mdAbs = path.join(rootAbs, entry.name, "SKILL.md");
      if (!fs.existsSync(mdAbs)) continue;

      const relPath = relativizeSkillMdForApi(mdAbs);
      if (seenRel.has(relPath)) continue;
      seenRel.add(relPath);

      let parsed;
      try {
        parsed = parseSKILLmd(mdAbs);
      } catch {
        continue;
      }
      if (!parsed) continue;

      const dirAbs = path.dirname(mdAbs);
      const skillDirRel = relativizeSkillMdForApi(dirAbs);

      items.push({
        source: "filesystem",
        relPath,
        skillDir: skillDirRel,
        name: parsed.name,
        description: parsed.description,
      });
    }
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves a cwd-relative POSIX path to SKILL.md if it exists and lies under an allowed skill root.
 */
export function resolveFilesystemSkillMd(relPathFromQuery: string): string | null {
  const raw = relPathFromQuery.trim();
  if (!raw.toLowerCase().endsWith("skill.md")) return null;

  const cwd = process.cwd();
  const pack = getCortexAppRoot();

  const candidates: string[] = [];
  if (path.isAbsolute(raw)) {
    candidates.push(path.normalize(raw));
  } else {
    const trimmed = raw.replace(/^\.?\//, "");
    if (trimmed.includes("..")) return null;
    const parts = trimmed.split("/").filter(Boolean);
    candidates.push(path.normalize(path.resolve(cwd, ...parts)));
    candidates.push(path.normalize(path.resolve(pack, ...parts)));
  }

  const seen = new Set<string>();
  for (const abs of candidates) {
    if (seen.has(abs)) continue;
    seen.add(abs);

    if (path.basename(abs) !== "SKILL.md") continue;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    if (!isUnderSomeSkillRoot(abs)) continue;

    return abs;
  }

  return null;
}
