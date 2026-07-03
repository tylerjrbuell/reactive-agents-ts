/**
 * Wraps Starlight's `docsLoader` to merge git-derived page metadata (badge,
 * lastCommit, changedSections — see `git-page-metadata.ts`) into each entry
 * at build time only. Never written back to the source .md/.mdx files, so
 * `bun run build` no longer diffs docs frontmatter on every run.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { docsLoader } from "@astrojs/starlight/loaders";
import type { Loader, LoaderContext } from "astro/loaders";
import { computeGitPageMetadata } from "./git-page-metadata.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function docsLoaderWithMeta(): Loader {
  const inner = docsLoader();
  return {
    name: "docs-loader-with-meta",
    async load(context: LoaderContext) {
      await inner.load(context);

      for (const entry of context.store.values()) {
        if (!entry.filePath) continue;

        const absFilePath = fileURLToPath(new URL(entry.filePath, context.config.root));
        const stability = (entry.data as Record<string, unknown>).stability as string | undefined;
        const meta = computeGitPageMetadata(absFilePath, REPO_ROOT, stability);

        if (Object.keys(meta).length === 0) continue;

        const data = { ...entry.data, ...meta };

        // Don't re-run context.parseData on the merged object: entry.data has
        // already been schema-validated (and transformed — e.g. Starlight's
        // hero icon shorthand) by the inner loader. Re-parsing an
        // already-transformed value against the same schema breaks it. We
        // fully control `meta`'s shape (matches the declared extend schema),
        // so a plain merge is safe.
        //
        // Must also generate a fresh digest: DataStore.set() silently no-ops
        // when the passed digest matches the existing entry's stored digest
        // (dedup-by-digest short-circuit) — reusing entry.digest unchanged
        // means this merge would never actually take effect.
        context.store.set({
          ...entry,
          data,
          digest: context.generateDigest(data),
        });
      }
    },
  };
}
