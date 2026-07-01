#!/usr/bin/env bun
/**
 * sync-page-metadata.ts
 *
 * Runs as prebuild. For each .md/.mdx under src/content/docs/:
 *   1. Gets last git commit info (subject, hash, date)
 *   2. Computes days since last change and since first commit
 *   3. Attempts to backfill `since:` from nearest git version tag
 *   4. Sets `badge:` frontmatter based on stability/age rules
 *   5. Sets `lastCommit:` for the "what changed" callout
 *
 * Never overwrites a manually-set `badge:` field.
 * Pass --dry-run to log changes without writing.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join, relative } from "path";
import matter from "gray-matter";

const DRY_RUN = process.argv.includes("--dry-run");
const DOCS_DIR = join(import.meta.dir, "../src/content/docs");
const REPO_ROOT = join(import.meta.dir, "../../..");
const NEW_THRESHOLD_DAYS = 14;
const UPDATED_THRESHOLD_DAYS = 15;


interface CommitInfo {
  subject: string;
  hash: string;
  date: string;
}

function git(cmd: string): string {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function getLastCommit(filePath: string): CommitInfo | null {
  const relPath = relative(REPO_ROOT, filePath);
  const out = git(`git log --follow -1 --pretty="%s|%H|%ad" --date=short -- "${relPath}"`);
  if (!out) return null;
  const [subject, hash, date] = out.split("|");
  if (!subject || !hash || !date) return null;
  return { subject: subject.trim(), hash: hash.trim(), date: date.trim() };
}

function getFirstCommitDate(filePath: string): string | null {
  const relPath = relative(REPO_ROOT, filePath);
  const out = git(`git log --follow --diff-filter=A --pretty="%ad" --date=short -- "${relPath}"`);
  // oldest entry is last line
  return out.split("\n").filter(Boolean).pop() ?? null;
}

function getNearestVersion(filePath: string): string | null {
  const relPath = relative(REPO_ROOT, filePath);
  const firstHash = git(
    `git log --follow --diff-filter=A --pretty="%H" -- "${relPath}"`
  )
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!firstHash) return null;
  const tag = git(`git describe --tags --match "v*" --abbrev=0 "${firstHash}" 2>/dev/null`);
  if (!tag) return null;
  // v0.12.0 → v0.12
  return tag.replace(/\.\d+$/, "");
}

function daysSince(dateStr: string): number {
  const date = new Date(dateStr + "T00:00:00Z");
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function computeBadge(
  stability: string | undefined,
  firstCommitDate: string | null,
  lastCommitDate: string | null,
  since: string | null,
): { text: string; variant: string } | null {
  // Stability takes priority over age
  if (stability === "experimental") return { text: "Experimental", variant: "caution" };
  if (stability === "unstable") return { text: "Unstable", variant: "default" };
  if (stability === "deprecated") return { text: "Deprecated", variant: "danger" };

  const firstAgeDays = firstCommitDate ? daysSince(firstCommitDate) : null;
  const lastAgeDays = lastCommitDate ? daysSince(lastCommitDate) : null;

  if (firstAgeDays !== null && firstAgeDays <= NEW_THRESHOLD_DAYS) {
    const version = since ?? "";
    return { text: "New", variant: "success" };
  }

  if (lastAgeDays !== null && lastAgeDays <= UPDATED_THRESHOLD_DAYS) {
    return { text: "Updated", variant: "note" };
  }

  return null;
}

function getChangedSections(filePath: string, hash: string, repoRoot: string): string[] {
  try {
    const diff = execSync(
      `git -C "${repoRoot}" show ${hash} -- "${filePath}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const lines = diff.split("\n");
    const sections: string[] = [];
    let currentHeading: string | null = null;
    let hasChanges = false;

    for (const line of lines) {
      // Context line with a heading (unchanged but surrounding)
      const contextHeading = line.match(/^ (#{1,3} .+)/);
      if (contextHeading) {
        if (hasChanges && currentHeading && !sections.includes(currentHeading)) {
          sections.push(currentHeading);
        }
        currentHeading = contextHeading[1].trim();
        hasChanges = false;
        continue;
      }
      // Added heading line
      const addedHeading = line.match(/^\+(#{1,3} .+)/);
      if (addedHeading) {
        if (hasChanges && currentHeading && !sections.includes(currentHeading)) {
          sections.push(currentHeading);
        }
        currentHeading = addedHeading[1].trim();
        hasChanges = true;
        continue;
      }
      // Any added content line (but not diff metadata)
      if (line.startsWith("+") && !line.startsWith("+++")) {
        hasChanges = true;
      }
    }
    // Flush last section
    if (hasChanges && currentHeading && !sections.includes(currentHeading)) {
      sections.push(currentHeading);
    }
    return sections.slice(0, 6); // cap at 6 sections to keep frontmatter small
  } catch {
    return [];
  }
}

async function main() {
  const { glob } = await import("glob");
  const files = await glob("**/*.{md,mdx}", { cwd: DOCS_DIR, absolute: true });
  let changed = 0;

  for (const filePath of files) {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;

    // Skip splash/index pages — they never get auto-badges
    if (data.template === "splash") continue;

    // Respect manually-set badges
    const hasBadge = Boolean(data.badge);
    const isAutoGenBadge =
      hasBadge &&
      typeof data.badge === "object" &&
      (data.badge as Record<string, string>).__auto === "1";
    if (hasBadge && !isAutoGenBadge) continue;

    const lastCommit = getLastCommit(filePath);
    const hash = lastCommit?.hash ?? null;
    const changedSections = hash ? getChangedSections(filePath, hash, REPO_ROOT) : [];
    const firstDate = getFirstCommitDate(filePath);

    // Backfill `since` from git tags if missing
    let since = (data.since as string | undefined) ?? null;
    if (!since) {
      since = getNearestVersion(filePath);
    }

    const badge = computeBadge(
      data.stability as string | undefined,
      firstDate,
      lastCommit?.date ?? null,
      since,
    );

    const updates: Record<string, unknown> = {};

    if (badge) {
      updates.badge = { ...badge, __auto: "1" };
    } else if (isAutoGenBadge) {
      // Remove stale auto-badge
      updates.badge = undefined;
    }

    if (lastCommit) {
      // Only update lastCommit if values have changed
      const newLastCommit = {
        subject: lastCommit.subject,
        hash: lastCommit.hash.slice(0, 7),
        date: lastCommit.date,
      };

      const existingLastCommit = data.lastCommit as Record<string, unknown> | undefined;
      const hasChanged =
        !existingLastCommit ||
        existingLastCommit.subject !== newLastCommit.subject ||
        existingLastCommit.hash !== newLastCommit.hash ||
        existingLastCommit.date !== newLastCommit.date;

      if (hasChanged) {
        updates.lastCommit = newLastCommit;
      }
    }

    if (changedSections.length > 0) {
      const existingChangedSections = data.changedSections as string[] | undefined;
      const sectionsChanged =
        !existingChangedSections ||
        JSON.stringify(existingChangedSections) !== JSON.stringify(changedSections);
      if (sectionsChanged) {
        updates.changedSections = changedSections;
      }
    }

    if (since && !data.since) {
      updates.since = since;
    }

    if (Object.keys(updates).length === 0) continue;

    const newData = { ...data };
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) {
        delete newData[k];
      } else {
        newData[k] = v;
      }
    }

    const newContent = matter.stringify(parsed.content, newData);

    if (DRY_RUN) {
      console.log(`[dry-run] ${relative(DOCS_DIR, filePath)}`);
      console.log("  updates:", JSON.stringify(updates, null, 2));
    } else {
      writeFileSync(filePath, newContent, "utf-8");
      changed++;
    }
  }

  console.log(DRY_RUN ? `[dry-run] ${files.length} files scanned` : `sync-page-metadata: updated ${changed}/${files.length} files`);
}

main().catch((err) => {
  console.error("sync-page-metadata failed:", err);
  process.exit(1);
});
