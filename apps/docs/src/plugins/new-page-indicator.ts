import type { AstroIntegration } from "astro";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Options = {
  /** Pages added or modified within this many days count as new. Default 30. */
  withinDays?: number;
};

const NEW_PAGES_SCRIPT_ID = "__ra_new_pages_data__";

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listMarkdownFiles(full));
    else if (/\.(md|mdx)$/.test(entry)) out.push(full);
  }
  return out;
}

function parseFrontmatter(file: string): Record<string, unknown> {
  const text = readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.+?)\s*$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw === "true") fm[key] = true;
    else if (raw === "false") fm[key] = false;
    else fm[key] = raw.replace(/^["']|["']$/g, "");
  }
  return fm;
}

function gitLastChange(file: string, cwd: string): number | null {
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${file}"`, {
      cwd,
      encoding: "utf8",
    }).trim();
    if (!iso) return null;
    return new Date(iso).getTime();
  } catch {
    return null;
  }
}

function fileToSlug(file: string, contentDocsDir: string): string {
  let rel = relative(contentDocsDir, file).replace(/\\/g, "/");
  rel = rel.replace(/\.(md|mdx)$/, "");
  rel = rel.replace(/(^|\/)index$/, "");
  return "/" + rel.replace(/\/$/, "");
}

export function newPageIndicator(opts: Options = {}): AstroIntegration {
  const withinDays = opts.withinDays ?? 30;

  return {
    name: "new-page-indicator",
    hooks: {
      "astro:config:setup": ({ config, injectScript, logger }) => {
        const srcDir = fileURLToPath(config.srcDir);
        const contentDocsDir = resolve(srcDir, "content/docs");
        const repoRoot = resolve(srcDir, "..", "..", "..");

        const files = listMarkdownFiles(contentDocsDir);
        const now = Date.now();
        const cutoff = now - withinDays * 24 * 60 * 60 * 1000;
        const newSlugs: string[] = [];

        for (const file of files) {
          const fm = parseFrontmatter(file);
          let isNew = false;

          if (fm.isNew === true) isNew = true;

          if (typeof fm.newUntil === "string") {
            const until = new Date(fm.newUntil).getTime();
            if (!isNaN(until) && until > now) isNew = true;
          }

          if (!isNew) {
            const lastChange = gitLastChange(file, repoRoot);
            if (lastChange != null && lastChange >= cutoff) isNew = true;
          }

          if (isNew) newSlugs.push(fileToSlug(file, contentDocsDir));
        }

        logger.info(
          `new-page-indicator: ${newSlugs.length} new page(s) within ${withinDays}d`,
        );

        injectScript(
          "head-inline",
          `window.${NEW_PAGES_SCRIPT_ID}=${JSON.stringify(newSlugs)};`,
        );
      },
    },
  };
}
