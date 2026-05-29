// Run: bun test packages/core/tests/doc-drift.test.ts --timeout 15000
//
// WS-5 Phase 4 — AGENTS.md package-tree doc-drift gate (#171 K-04).
//
// PREMISE
// -------
// The "Package Dependency Tree" code-fenced block at the top of
// `AGENTS.md` is the canonical entry-point map agents read to orient
// themselves. When packages land on disk but never appear in the tree,
// AI agents (Claude / Cursor / Codex) silently miss capabilities; when
// the tree references a package that no longer exists, agents chase
// dead links. Both modes are "scaffold without callers" drift.
//
// This test pins both directions:
//
//   1. disk → doc — every `packages/*/package.json` `name` field must
//      appear as an exact literal inside the dependency-tree block.
//      Catches stale documentation lagging behind net-new packages.
//
//   2. doc → disk — every `@reactive-agents/<name>` or bare-name token
//      mentioned inside the dependency-tree block must correspond to
//      a real on-disk package name. Catches dangling references to
//      packages that were renamed or removed.
//
// SCOPE
// -----
// We intentionally scope to the dependency-tree fenced block only
// (lines bounded by ` ``` Foundation ... ``` `). Casual prose mentions
// of `@reactive-agents/foo` further down in AGENTS.md are not the
// canonical capability map and must not affect this gate (false-
// negative trap flagged in advisor review).
//
// FAILURE OUTPUT
// --------------
// On breach we enumerate the missing names plus a fix hint pointing
// at the `### Package Dependency Tree` section, so the agent reading
// the failure has a single concrete next action.

import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const AGENTS_MD = join(REPO_ROOT, "AGENTS.md");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/**
 * Read every `packages/<name>/package.json` `name` field.
 * Skip workspace-only manifests that lack a `name`.
 */
function discoverDiskPackages(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const pkgJson = join(PACKAGES_DIR, entry, "package.json");
    let st;
    try {
      st = statSync(pkgJson);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const raw = readFileSync(pkgJson, "utf-8");
    const parsed = JSON.parse(raw) as { name?: string };
    if (typeof parsed.name === "string" && parsed.name.length > 0) {
      out.push(parsed.name);
    }
  }
  return out.sort();
}

/**
 * Extract the first fenced code block immediately following the
 * `### Package Dependency Tree` heading. We use string anchors rather
 * than line numbers so insertions above don't break the test.
 */
function extractDependencyTreeBlock(agentsMd: string): string {
  const heading = "### Package Dependency Tree";
  const headingIdx = agentsMd.indexOf(heading);
  if (headingIdx === -1) {
    throw new Error(
      `AGENTS.md is missing the '${heading}' heading. ` +
        `The doc-drift gate cannot operate without this canonical anchor.`,
    );
  }
  const after = agentsMd.slice(headingIdx);
  const fenceOpen = after.indexOf("```");
  if (fenceOpen === -1) {
    throw new Error(
      `No code fence found after '${heading}'. Dependency tree must be a fenced block.`,
    );
  }
  const fenceContentStart =
    fenceOpen + after.slice(fenceOpen).indexOf("\n") + 1;
  const fenceClose = after.indexOf("```", fenceContentStart);
  if (fenceClose === -1) {
    throw new Error(
      `Unterminated dependency-tree code fence after '${heading}'.`,
    );
  }
  return after.slice(fenceContentStart, fenceClose);
}

/**
 * Extract the set of package-name tokens referenced inside the
 * dependency-tree block:
 *   • `@reactive-agents/<name>` namespaced literals
 *   • the bare umbrella `reactive-agents` (no leading slash / dash)
 *   • the bare scaffold CLI `create-reactive-agent`
 *
 * Bare-name regex uses word-boundary lookarounds to avoid matching
 * substrings of `@reactive-agents/...`.
 */
function extractDocReferences(block: string): Set<string> {
  const refs = new Set<string>();

  // Namespaced.
  const nsRe = /@reactive-agents\/[a-z0-9-]+/g;
  for (const m of block.matchAll(nsRe)) {
    refs.add(m[0]);
  }

  // Bare umbrella `reactive-agents` — disallow `@`, `/`, `-` adjacency
  // to prevent matching `@reactive-agents/...` or `create-reactive-agent`.
  const umbrellaRe = /(?<![@/\-a-z])reactive-agents(?![/\-a-z0-9])/g;
  if (umbrellaRe.test(block)) {
    refs.add("reactive-agents");
  }

  // Bare scaffold CLI.
  if (/\bcreate-reactive-agent\b/.test(block)) {
    refs.add("create-reactive-agent");
  }

  return refs;
}

describe("WS-5 Phase 4 — AGENTS.md package-tree doc-drift", () => {
  const agentsMd = readFileSync(AGENTS_MD, "utf-8");
  const block = extractDependencyTreeBlock(agentsMd);
  const docRefs = extractDocReferences(block);
  const diskPkgs = discoverDiskPackages();

  it("every on-disk package appears in the AGENTS.md dependency-tree block (disk → doc)", () => {
    const missing = diskPkgs.filter((name) => !docRefs.has(name));
    if (missing.length > 0) {
      const msg =
        `AGENTS.md '### Package Dependency Tree' block is missing ${missing.length} ` +
        `on-disk package(s):\n` +
        missing.map((n) => `  • ${n}`).join("\n") +
        `\n\nFix: add each missing package to the fenced dependency-tree block ` +
        `under '### Package Dependency Tree' in AGENTS.md. Slot each entry in ` +
        `its architectural tier (Foundation / mid-tier / Facade & Runtime) based ` +
        `on its declared @reactive-agents/* dependencies.`;
      throw new Error(msg);
    }
    expect(missing).toEqual([]);
  });

  it("every AGENTS.md dependency-tree reference resolves to a real on-disk package (doc → disk)", () => {
    const diskSet = new Set(diskPkgs);
    const dangling: string[] = [];
    for (const ref of docRefs) {
      if (!diskSet.has(ref)) dangling.push(ref);
    }
    dangling.sort();
    if (dangling.length > 0) {
      const msg =
        `AGENTS.md '### Package Dependency Tree' block references ${dangling.length} ` +
        `package(s) that no longer exist on disk:\n` +
        dangling.map((n) => `  • ${n}`).join("\n") +
        `\n\nFix: either restore the package under packages/ or remove the stale ` +
        `reference from the dependency-tree block in AGENTS.md.`;
      throw new Error(msg);
    }
    expect(dangling).toEqual([]);
  });
});
