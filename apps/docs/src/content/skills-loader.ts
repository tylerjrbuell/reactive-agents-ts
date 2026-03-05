import { existsSync, promises as fs } from "node:fs";
import { basename, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import type { Loader, LoaderContext } from "astro/loaders";

type SkillFile = {
  content: string;
  encoding: "utf-8" | "base64";
  contentType: string;
};

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".tif",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".wasm",
  ".bin",
]);

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".ts": "text/typescript",
  ".js": "text/javascript",
  ".sh": "text/x-shellscript",
  ".py": "text/x-python",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function getMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

function isBinary(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

async function walkFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = `${dirPath}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function toSkillId(basePath: string, skillMdPath: string): string {
  const rel = normalizePath(relative(basePath, skillMdPath));
  return rel.replace(/\/SKILL\.md$/, "");
}

export function starlightSafeSkillsLoader(options?: { base?: string }): Loader {
  const base = options?.base ?? "./skills";

  return {
    name: "starlight-safe-skills-loader",
    async load(context: LoaderContext) {
      const { config, logger, store, parseData, generateDigest } = context;
      const baseDir = new URL(base.endsWith("/") ? base : `${base}/`, config.root);
      const basePath = fileURLToPath(baseDir);

      store.clear();

      if (!existsSync(basePath)) {
        logger.warn(`Skills directory "${base}" does not exist.`);
        return;
      }

      const allFiles = await walkFiles(basePath);
      const skillMdFiles = allFiles.filter((path) => basename(path) === "SKILL.md");

      if (skillMdFiles.length === 0) {
        logger.warn(`No skills found in "${base}". Add at least one SKILL.md file.`);
        return;
      }

      for (const skillMdPath of skillMdFiles) {
        const skillId = toSkillId(basePath, skillMdPath);
        const skillDir = skillMdPath.slice(0, -"/SKILL.md".length);
        const skillMdContent = await fs.readFile(skillMdPath, "utf-8");
        const { data, content } = matter(skillMdContent);

        const name = typeof data.name === "string" ? data.name : null;
        const description = typeof data.description === "string" ? data.description : null;

        if (!name || !description) {
          logger.error(`Skill "${skillId}" must include string frontmatter fields "name" and "description".`);
          continue;
        }

        const skillFiles = await walkFiles(skillDir);
        const files: Record<string, SkillFile> = {};

        for (const filePath of skillFiles) {
          const relPath = normalizePath(relative(skillDir, filePath));
          const binary = isBinary(filePath);

          if (binary) {
            const buffer = await fs.readFile(filePath);
            files[relPath] = {
              content: buffer.toString("base64"),
              encoding: "base64",
              contentType: getMimeType(filePath),
            };
          } else {
            files[relPath] = {
              content: await fs.readFile(filePath, "utf-8"),
              encoding: "utf-8",
              contentType: getMimeType(filePath),
            };
          }
        }

        const parsed = await parseData({
          id: skillId,
          data: { name, description, files },
        });

        const digest = generateDigest(
          JSON.stringify({ skillId, name, description, files: Object.keys(files).sort() }),
        );

        store.set({
          id: skillId,
          data: parsed as Record<string, unknown>,
          body: content,
          digest,
        });
      }

      logger.info(`Loaded ${skillMdFiles.length} skill(s) from "${base}".`);
    },
  };
}
