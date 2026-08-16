/**
 * kernel/state/scratchpad-spill.ts — bounded scratchpad with disk spill.
 *
 * `state.scratchpad` (kernel-state.ts) is an in-memory `Map<string,string>`
 * that `tool-execution.ts` auto-stores compressed-overflow tool results into
 * (see `ResultCompressionConfig`). Two gaps: no aggregate size cap (a long
 * run accumulating many large tool results grows this map unbounded), and no
 * disk persistence (content is lost if the process dies without a durable
 * checkpoint — the same class of evidence loss the 2026-08-16
 * `assembleDeliverable` grounding fix (c2418864) had to work around on the
 * READ side). This closes the WRITE-side gap: entries past a byte budget
 * spill to `~/.reactive-agents/spill/<namespace>/<key>.txt`, and the
 * in-memory map keeps only a small marker string instead of the full value —
 * so the map itself is what gets durably checkpointed either way, unchanged
 * in shape, but bounded in size.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Marker prefix distinguishing a spilled reference from real stored content. */
const SPILL_MARKER_PREFIX = "[SPILLED_TO_DISK:";
const SPILL_MARKER_RE = /^\[SPILLED_TO_DISK:(.+)\]$/;

/** Aggregate scratchpad size (bytes, UTF-8) past which new writes spill to disk. Default: 5 MB. */
export const DEFAULT_SCRATCHPAD_SPILL_THRESHOLD_BYTES = 5 * 1024 * 1024;

function spillDir(namespace: string): string {
  const home = homedir();
  const base = home ? join(home, ".reactive-agents", "spill") : join(".reactive-agents", "spill");
  return join(base, namespace);
}

function spillPath(namespace: string, key: string): string {
  // Keys are harness-generated (`_tool_result_N`, compressor keys) — never
  // model-supplied — so no path-traversal sanitization is needed here, unlike
  // the file-write tool's model-facing path handling.
  return join(spillDir(namespace), `${key}.txt`);
}

function aggregateBytes(scratchpad: ReadonlyMap<string, string>): number {
  let total = 0;
  for (const value of scratchpad.values()) total += Buffer.byteLength(value, "utf8");
  return total;
}

/**
 * Set a scratchpad entry, spilling to disk instead of growing the in-memory
 * map once the aggregate size would exceed `thresholdBytes`. `namespace`
 * scopes the spill directory (pass `sessionId` or `agentId` — whatever the
 * caller already threads) so concurrent runs' same-named keys
 * (`_tool_result_1`) never collide on disk.
 */
export function setScratchpadBounded(
  scratchpad: Map<string, string>,
  key: string,
  value: string,
  namespace: string,
  thresholdBytes: number = DEFAULT_SCRATCHPAD_SPILL_THRESHOLD_BYTES,
): void {
  const projected = aggregateBytes(scratchpad) + Buffer.byteLength(value, "utf8");
  if (projected <= thresholdBytes) {
    scratchpad.set(key, value);
    return;
  }
  const path = spillPath(namespace, key);
  mkdirSync(spillDir(namespace), { recursive: true });
  writeFileSync(path, value, "utf8");
  scratchpad.set(key, `${SPILL_MARKER_PREFIX}${path}]`);
}

/**
 * Resolve a scratchpad value that may be a spill marker back to its full
 * content. Transparent to every read site (`resolveStoredToolObservation`,
 * `resolveUnconsumedEvidence`) — they call this instead of using the raw map
 * value directly. Returns the marker string unchanged if the spilled file is
 * missing (defensive; should not happen in practice).
 */
export function resolveScratchpadValue(raw: string): string {
  const match = SPILL_MARKER_RE.exec(raw);
  if (!match) return raw;
  const path = match[1]!;
  if (!existsSync(path)) return raw;
  return readFileSync(path, "utf8");
}
