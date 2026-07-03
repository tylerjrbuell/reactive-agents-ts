/**
 * Computes git-derived page metadata (badge, lastCommit, changedSections) for
 * a docs page. Pure and read-only — never writes to disk. Called fresh from
 * `docs-loader-with-meta.ts` on every build, so the result is never persisted
 * into source frontmatter and can't go stale.
 */
import { execSync } from "node:child_process";
import { relative } from "node:path";

const NEW_THRESHOLD_DAYS = 14;
const UPDATED_THRESHOLD_DAYS = 15;

interface CommitInfo {
  subject: string;
  hash: string;
  date: string;
}

function git(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function getLastCommit(absFilePath: string, repoRoot: string): CommitInfo | null {
  const relPath = relative(repoRoot, absFilePath);
  const out = git(`git log --follow -1 --pretty="%s|%H|%ad" --date=short -- "${relPath}"`, repoRoot);
  if (!out) return null;
  const [subject, hash, date] = out.split("|");
  if (!subject || !hash || !date) return null;
  return { subject: subject.trim(), hash: hash.trim(), date: date.trim() };
}

function getFirstCommitDate(absFilePath: string, repoRoot: string): string | null {
  const relPath = relative(repoRoot, absFilePath);
  const out = git(
    `git log --follow --diff-filter=A --pretty="%ad" --date=short -- "${relPath}"`,
    repoRoot,
  );
  return out.split("\n").filter(Boolean).pop() ?? null;
}

function daysSince(dateStr: string): number {
  const date = new Date(dateStr + "T00:00:00Z");
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function computeBadgeFields(
  stability: string | undefined,
  firstCommitDate: string | null,
  lastCommitDate: string | null,
): { text: string; variant: string } | null {
  // Stability takes priority over age.
  if (stability === "experimental") return { text: "Experimental", variant: "caution" };
  if (stability === "unstable") return { text: "Unstable", variant: "default" };
  if (stability === "deprecated") return { text: "Deprecated", variant: "danger" };

  const firstAgeDays = firstCommitDate ? daysSince(firstCommitDate) : null;
  const lastAgeDays = lastCommitDate ? daysSince(lastCommitDate) : null;

  if (firstAgeDays !== null && firstAgeDays <= NEW_THRESHOLD_DAYS) {
    return { text: "New", variant: "success" };
  }
  if (lastAgeDays !== null && lastAgeDays <= UPDATED_THRESHOLD_DAYS) {
    return { text: "Updated", variant: "note" };
  }
  return null;
}

function getChangedSections(absFilePath: string, hash: string, repoRoot: string): string[] {
  try {
    const diff = execSync(`git -C "${repoRoot}" show ${hash} -- "${absFilePath}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = diff.split("\n");
    const sections: string[] = [];
    let currentHeading: string | null = null;
    let hasChanges = false;

    for (const line of lines) {
      const contextHeading = line.match(/^ (#{1,3} .+)/);
      if (contextHeading) {
        if (hasChanges && currentHeading && !sections.includes(currentHeading)) {
          sections.push(currentHeading);
        }
        currentHeading = contextHeading[1].trim();
        hasChanges = false;
        continue;
      }
      const addedHeading = line.match(/^\+(#{1,3} .+)/);
      if (addedHeading) {
        if (hasChanges && currentHeading && !sections.includes(currentHeading)) {
          sections.push(currentHeading);
        }
        currentHeading = addedHeading[1].trim();
        hasChanges = true;
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        hasChanges = true;
      }
    }
    if (hasChanges && currentHeading && !sections.includes(currentHeading)) {
      sections.push(currentHeading);
    }
    return sections.slice(0, 6); // cap at 6 sections to keep payload small
  } catch {
    return [];
  }
}

export interface GitPageMetadata {
  badge?: { text: string; variant: string; __auto: "1" };
  lastCommit?: { subject: string; hash: string; date: string };
  changedSections?: string[];
}

export function computeGitPageMetadata(
  absFilePath: string,
  repoRoot: string,
  stability: string | undefined,
): GitPageMetadata {
  const lastCommit = getLastCommit(absFilePath, repoRoot);
  const firstDate = getFirstCommitDate(absFilePath, repoRoot);
  const changedSections = lastCommit
    ? getChangedSections(absFilePath, lastCommit.hash, repoRoot)
    : [];

  const result: GitPageMetadata = {};

  const badge = computeBadgeFields(stability, firstDate, lastCommit?.date ?? null);
  if (badge) result.badge = { ...badge, __auto: "1" };

  if (lastCommit) {
    result.lastCommit = {
      subject: lastCommit.subject,
      hash: lastCommit.hash.slice(0, 7),
      date: lastCommit.date,
    };
  }

  if (changedSections.length > 0) {
    result.changedSections = changedSections;
  }

  return result;
}
