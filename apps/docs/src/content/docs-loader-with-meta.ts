/**
 * Wraps Starlight's `docsLoader` to (1) merge each page's last commit
 * (display only, see `last-commit.ts`) into its entry and (2) fail the build
 * on invalid authored `since`/`updated` versions (see `indicators.ts`).
 * Nothing is written back to source frontmatter.
 */
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { docsLoader } from "@astrojs/starlight/loaders";
import type { Loader, LoaderContext } from "astro/loaders";
import {
  CURRENT_RELEASE,
  redundantStabilityLabel,
  validateVersions,
  type IndicatorFrontmatter,
} from "./indicators.js";
import { loadLastCommits } from "./last-commit.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CONTENT_DIR = join(REPO_ROOT, "apps/docs/src/content/docs");

export function docsLoaderWithMeta(): Loader {
  const inner = docsLoader();
  return {
    name: "docs-loader-with-meta",
    async load(context: LoaderContext) {
      await inner.load(context);

      const current = CURRENT_RELEASE;
      const commits = loadLastCommits(REPO_ROOT, CONTENT_DIR);
      const errors: string[] = [];

      for (const entry of context.store.values()) {
        errors.push(...validateVersions(entry.id, entry.data as IndicatorFrontmatter, current));
        const fm = entry.data as IndicatorFrontmatter & { title?: string; sidebar?: { label?: string } };
        for (const [where, text] of [["title", fm.title], ["sidebar.label", fm.sidebar?.label]] as const) {
          const bad = redundantStabilityLabel(`${entry.id} ${where}`, text, fm.stability);
          if (bad) errors.push(bad);
        }
        if (!entry.filePath) continue;

        const absFilePath = fileURLToPath(new URL(entry.filePath, context.config.root));
        const lastCommit = commits.get(relative(REPO_ROOT, absFilePath));
        if (!lastCommit) continue;

        // Merge without re-parsing: entry.data is already schema-validated and
        // transformed by the inner loader. A fresh digest is required, since
        // DataStore.set() no-ops when the digest matches the stored entry.
        const data = { ...entry.data, lastCommit };
        context.store.set({ ...entry, data, digest: context.generateDigest(data) });
      }

      if (errors.length > 0) throw new Error(`Invalid page indicators:\n${errors.join("\n")}`);
    },
  };
}
