import { mkdirSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

/**
 * Creates parent directories for a file path. Used before `withLogging({ output: "file" })`
 * so `appendFileSync` never fails with ENOENT when `.cortex/logs` (or similar) is missing.
 * Safe to call repeatedly.
 */
export function ensureParentDirForFile(filePath: string): void {
  const abs = resolve(filePath);
  const dir = dirname(abs);
  const root = parse(abs).root;
  if (!dir || dir === root) return;
  mkdirSync(dir, { recursive: true });
}
