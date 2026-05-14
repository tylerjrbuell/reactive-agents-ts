import { createRequire } from "node:module";
import { isBun } from "./detect.js";
import type { GlobLike } from "./types.js";

const require = createRequire(import.meta.url);

interface BunGlobApi {
  Glob: new (pattern: string) => {
    scan(opts?: { cwd?: string; onlyFiles?: boolean }): AsyncIterable<string>;
  };
}

function globBun(pattern: string): GlobLike {
  const Bun = (globalThis as { Bun?: BunGlobApi }).Bun;
  if (!Bun) throw new Error("globBun called when Bun runtime not present");
  const bunGlob = new Bun.Glob(pattern);
  return {
    scan: (opts?: { cwd?: string; onlyFiles?: boolean }) =>
      bunGlob.scan({ cwd: opts?.cwd, onlyFiles: opts?.onlyFiles ?? true }),
  };
}

function globNode(pattern: string): GlobLike {
  return {
    scan: async function* (opts?: { cwd?: string; onlyFiles?: boolean }): AsyncIterable<string> {
      try {
        const fsp = require("node:fs/promises") as typeof import("node:fs/promises");
        // node:fs.glob — available Node 22+
        const nodeGlob = (fsp as unknown as { glob?: (pat: string, opts?: { cwd?: string }) => AsyncIterable<string> })
          .glob;
        if (typeof nodeGlob === "function") {
          for await (const entry of nodeGlob(pattern, { cwd: opts?.cwd })) {
            yield entry;
          }
          return;
        }
      } catch {
        // fall through to manual
      }

      // Fallback: simple readdir for *.ext or basename patterns
      const fsp = require("node:fs/promises") as typeof import("node:fs/promises");
      const cwd = opts?.cwd ?? ".";
      const entries = await fsp.readdir(cwd);
      const isExtPattern = pattern.startsWith("*.");
      const ext = isExtPattern ? pattern.slice(1) : null;
      for (const name of entries) {
        if (!ext || name.endsWith(ext)) yield name;
      }
    },
  };
}

/**
 * Cross-runtime glob pattern matching.
 * Bun: Uses Bun.Glob (native, zero overhead).
 * Node: Uses node:fs.glob (Node 22+) with fallback to simple readdir for *.ext patterns.
 *
 * @param pattern - Glob pattern (e.g., "*.json", "src/**\/*.ts")
 * @returns GlobLike object with async iterable scan() method
 */
export function glob(pattern: string): GlobLike {
  if (isBun) return globBun(pattern);
  return globNode(pattern);
}
