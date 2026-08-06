// File: src/kernel/capabilities/verify/file-truth.ts
//
// The filesystem ground-truth capability for the success authority (Move 2 /
// Sys-audit 2026-07-29 RC#1). `verify()` is pure and takes a `fileExists`
// injection rather than importing `fs` itself; this module is the default
// implementation the terminal gate supplies in production. Kept tiny and
// dependency-light so a non-node host (or a test) can inject its own.

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { getFileRoot } from "@reactive-agents/tools";

/**
 * Does `path` name an existing file/dir on disk? Deterministic ground truth for
 * `ArtifactProduced`. Contract target paths are typically relative (e.g.
 * `./cryptos.md`) and the file-write tool writes them relative to the ACTIVE
 * file root — `getFileRoot()`, which is `process.cwd()` unless the run is
 * wrapped in `withFileRoot()` (a sandbox / per-task temp dir). The default cwd
 * MUST match the writer's root: resolving a relative target against
 * `process.cwd()` while the writer targeted a sandbox root made the check look
 * in the wrong directory, report the deliverable missing, and steer a COMPLETED
 * run into a fabricated `harness_deliverable` the verifier then rejected
 * (observed live on Groq/Gemini native-FC via `withFileRoot`). An absolute
 * target is checked as-is. Any fs error degrades to `false` — the safe
 * direction: the override can only ADD a MET, never remove one.
 */
export function nodeFileExists(path: string, cwd: string = getFileRoot()): boolean {
  try {
    const trimmed = path.trim();
    if (trimmed.length === 0) return false;
    const abs = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
    return existsSync(abs);
  } catch {
    return false;
  }
}
