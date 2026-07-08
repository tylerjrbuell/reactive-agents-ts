// File: src/assembly/gather-dedup.ts
//
// Gather-dedup index (Wave C / task C3, audit 03-F6).
//
// A duplicate gathering call — the SAME read-only/search tool with the SAME
// normalized arguments as an earlier SUCCESSFUL call — wastes an iteration and
// re-fetches data the run already holds. This module detects those against the
// RunLedger and produces (a) `harness-signal` ledger entries flagging the
// duplicate and (b) a guidance nudge that hands the model back the EXISTING
// recallable ref instead of re-fetching.
//
// ADVISORY ONLY (audit 03-F6): it never blocks the call — it flags + nudges.
// Promotion to a hard block waits until benched.
//
// Pure — no Effect, no state. `normalizeArgsHash` uses node:crypto only.

import { createHash } from "node:crypto";
import {
  entriesOfKind,
  type LedgerEntryInput,
  type RunLedger,
} from "../kernel/ledger/run-ledger.js";
import { renderRecallHint } from "./ref-grammar.js";

// ─── Argument normalization ──────────────────────────────────────────────────

/** Deterministic stringify with recursively sorted object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * A stable hash of a tool call's arguments, invariant to key ORDER. Two calls
 * with the same logical args hash-equal even if the model emitted keys in a
 * different order.
 */
export function normalizeArgsHash(args: Readonly<Record<string, unknown>> | undefined): string {
  return createHash("sha256").update(stableStringify(args ?? {})).digest("hex").slice(0, 12);
}

// ─── Gathering-tool classification ───────────────────────────────────────────

/** Substrings that mark a READ-ONLY gathering/search tool (dedup candidates). */
const GATHER_KEYWORDS = [
  "search", "http", "browse", "fetch", "scrape", "crawl", "read", "get", "list", "query",
] as const;
/** Substrings that mark a SIDE-EFFECTING tool — never a dedup target (re-doing a
 *  write/send is legitimate). Takes precedence over GATHER_KEYWORDS. */
const MUTATION_KEYWORDS = [
  "write", "save", "send", "post", "put", "delete", "create", "update", "exec", "code", "run",
] as const;

/** True iff `toolName` is a read-only gathering call eligible for dedup. */
export function isGatheringTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  if (MUTATION_KEYWORDS.some((k) => n.includes(k))) return false;
  return GATHER_KEYWORDS.some((k) => n.includes(k));
}

// ─── Duplicate detection over the ledger ─────────────────────────────────────

/** A round's tool call, as fed to the detector. */
export interface RoundCall {
  readonly toolName: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly toolCallId?: string;
}

/** A detected duplicate gather + the existing ref to reuse. */
export interface DuplicateGather {
  readonly toolName: string;
  readonly argsHash: string;
  /** The recallable ref of the earlier result, when it was stored. */
  readonly priorRef?: string;
}

function keyOf(toolName: string, argsHash: string): string {
  return `${toolName}\u0000${argsHash}`;
}

/**
 * Build `(tool, argsHash) → priorRef` from the ledger: for every PRIOR
 * successful gathering `tool-result`, join back to its `tool-invocation` (by
 * toolCallId) to recover the args, and index the storedKey as the reusable ref.
 * Only the FIRST occurrence of a key is kept (the original fetch).
 */
export function buildGatherIndex(ledger: RunLedger | undefined): ReadonlyMap<string, string | undefined> {
  const invocations = entriesOfKind(ledger, "tool-invocation");
  const results = entriesOfKind(ledger, "tool-result");
  const argsByCallId = new Map<string, Readonly<Record<string, unknown>>>();
  for (const inv of invocations) {
    if (inv.toolCallId && inv.args) argsByCallId.set(inv.toolCallId, inv.args);
  }
  const index = new Map<string, string | undefined>();
  for (const r of results) {
    if (!r.success) continue;
    const toolName = r.toolName;
    if (!toolName || !isGatheringTool(toolName)) continue;
    const args = r.toolCallId ? argsByCallId.get(r.toolCallId) : undefined;
    if (args === undefined) continue; // no recoverable args → cannot dedup safely
    const key = keyOf(toolName, normalizeArgsHash(args));
    if (!index.has(key)) index.set(key, r.storedKey);
  }
  return index;
}

/**
 * Flag any call in `roundCalls` that repeats a prior successful gather. Advisory
 * — the caller does NOT block; it appends the returned signal entries + surfaces
 * the nudge.
 */
export function detectDuplicateGathers(
  ledger: RunLedger | undefined,
  roundCalls: readonly RoundCall[],
): readonly DuplicateGather[] {
  const index = buildGatherIndex(ledger);
  const seenThisRound = new Set<string>();
  const dups: DuplicateGather[] = [];
  for (const call of roundCalls) {
    if (!isGatheringTool(call.toolName)) continue;
    const argsHash = normalizeArgsHash(call.args);
    const key = keyOf(call.toolName, argsHash);
    if (seenThisRound.has(key)) continue; // report each duplicate key once
    if (!index.has(key)) continue;
    seenThisRound.add(key);
    dups.push({ toolName: call.toolName, argsHash, priorRef: index.get(key) });
  }
  return dups;
}

// ─── Ledger flags + guidance nudge ───────────────────────────────────────────

/** `harness-signal` ledger entries flagging each detected duplicate gather. */
export function dedupSignalEntries(
  dups: readonly DuplicateGather[],
  iteration: number,
): readonly LedgerEntryInput[] {
  return dups.map((d) => ({
    kind: "harness-signal" as const,
    iteration,
    signal: "gather-dedup",
    detail: `duplicate gather ${d.toolName} (args ${d.argsHash})${
      d.priorRef ? ` — prior result ${d.priorRef}` : ""
    }`,
  }));
}

/**
 * A guidance nudge that hands the model back the existing ref(s) via the ONE
 * recall grammar. `null` when nothing is flagged (byte-identical default path).
 */
export function buildDedupNudge(dups: readonly DuplicateGather[]): string | null {
  if (dups.length === 0) return null;
  const lines = dups.map((d) =>
    d.priorRef
      ? `${d.toolName} was already called with these arguments — the result is stored. Re-read it with ${renderRecallHint(d.priorRef, "full")} instead of fetching again.`
      : `${d.toolName} was already called with these arguments earlier. Use the result you already have instead of fetching again.`,
  );
  return `Duplicate gather detected: ${lines.join(" ")}`;
}
