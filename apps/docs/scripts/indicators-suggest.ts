#!/usr/bin/env bun
/**
 * docs:indicators:suggest — report-only. Evidence for `since:` / `updated:` /
 * `<Since>` tagging: which doc pages were added or changed since the latest
 * release tag, and which headings are new. It never edits a page; a human (or
 * docs-warden) decides. See wiki/Reference/Docs-Indicators.md.
 *
 *   bun run docs:indicators:suggest            # since the latest reachable v* tag
 *   bun run docs:indicators:suggest v0.17.0    # since an explicit ref
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  formatMinor,
  latestReleaseTag,
  listReachableTags,
  parseMinor,
  upcomingRelease,
} from "../src/content/indicators";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const DOCS = "apps/docs/src/content/docs/";

export interface Change {
  readonly status: "A" | "M" | "D" | "R";
  readonly file: string;
}

export interface Suggestion {
  readonly page: string;
  readonly change: Change["status"];
  readonly authored: { since?: string; updated?: string };
  readonly newHeadings: readonly string[];
  readonly advice: string;
}

/** `git diff --name-status` lines for doc pages (renames collapse to the new path). */
export function parseNameStatus(out: string): Change[] {
  const changes: Change[] = [];
  for (const line of out.split("\n")) {
    const [s, ...paths] = line.split("\t");
    const file = paths.at(-1);
    if (!s || !file || !file.startsWith(DOCS) || !/\.mdx?$/.test(file)) continue;
    const status = s[0] as Change["status"];
    if (status === "A" || status === "M" || status === "D" || status === "R") changes.push({ status, file });
  }
  return changes;
}

/** Headings added in a unified diff (`+## Title`), tags stripped. */
export function addedHeadings(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => /^\+#{2,4}\s/.test(l))
    .map((l) => l.replace(/^\+#{2,4}\s+/, "").replace(/<Since\b[^>]*\/?>/g, "").replace(/`/g, "").trim());
}

export function frontmatterOf(text: string): { since?: string; updated?: string } {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const pick = (k: string) => fm.match(new RegExp(`^${k}:\\s*["']?([\\d.]+)["']?\\s*$`, "m"))?.[1];
  const since = pick("since");
  const updated = pick("updated");
  return { ...(since ? { since } : {}), ...(updated ? { updated } : {}) };
}

export function suggest(
  change: Change,
  authored: { since?: string; updated?: string },
  headings: readonly string[],
  upcoming: string,
): Suggestion {
  const page = change.file.slice(DOCS.length).replace(/\.mdx?$/, "").replace(/\/index$/, "");
  let advice: string;
  if (change.status === "D") advice = "deleted: remove inbound links";
  else if (change.status === "A") advice = authored.since ? `ok (since ${authored.since})` : `new page: add since: "${upcoming}" if it documents a ${upcoming} feature`;
  else if (headings.length > 0) advice = authored.updated || authored.since ? `ok (${authored.updated ? `updated ${authored.updated}` : `since ${authored.since}`}); tag new sections with <Since version="${upcoming}" />` : `new sections: add updated: "${upcoming}" and tag them with <Since version="${upcoming}" />`;
  else advice = "edited, no new headings: tag only if the change is material (a release note, changeset or diff must show it)";
  return { page, change: change.status, authored, newHeadings: headings, advice };
}

function git(args: string[]): string {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

if (import.meta.main) {
  const base = process.argv[2] ?? (() => {
    const tag = latestReleaseTag(listReachableTags(REPO_ROOT));
    if (!tag) throw new Error("no reachable v* tag; pass a ref explicitly");
    return `v${tag}`;
  })();
  const upcoming = formatMinor(upcomingRelease(parseMinor(base)!));
  // Committed and working-tree changes both count: the diff is against the ref, not HEAD.
  const changes = parseNameStatus(git(["diff", "--name-status", "-M", base, "--", DOCS]));
  console.log(`Docs changes since ${base} (unreleased minor: ${upcoming}). Report only; nothing is edited.\n`);
  for (const c of changes) {
    const heads = c.status === "D" ? [] : addedHeadings(git(["diff", "-U0", base, "--", c.file]));
    const authored = c.status === "D" ? {} : frontmatterOf(readFileSync(join(REPO_ROOT, c.file), "utf8"));
    const s = suggest(c, authored, c.status === "A" ? [] : heads, upcoming);
    console.log(`${s.change}  ${s.page}\n     ${s.advice}`);
    for (const h of s.newHeadings.slice(0, 6)) console.log(`     + ${h}`);
    if (s.newHeadings.length > 6) console.log(`     + ${s.newHeadings.length - 6} more`);
  }
  console.log(`\n${changes.length} page(s).`);
}
