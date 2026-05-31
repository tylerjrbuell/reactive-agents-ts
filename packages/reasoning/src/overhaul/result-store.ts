/**
 * Overhaul — system-owned result store + deterministic materializer.
 *
 * Principle #1/#2/#7: tool results live in a SYSTEM store keyed by a stable
 * reference id. The model never holds the bulk inline and never copies a marker;
 * it orchestrates by reference. When a deliverable consumes a result, the system
 * MATERIALIZES the full data deterministically (no LLM) into the requested shape.
 *
 * This is the brick that fixes the 20-commit overflow: `materialize(ref, "bullets")`
 * renders ALL N items from stored data, regardless of any context-window budget.
 *
 * Pure + dependency-free. Lives outside kernel/** so it is A/B-able and sidesteps
 * the kernel-warden pilot; the kernel calls it through one flag-gated seam.
 */

import { renderValue, describeShape, type ResultFormat } from "@reactive-agents/tools";

export type { ResultFormat };

export interface StoredResult {
  /** Stable reference id, e.g. "commits_1". Model references this; never sees the bulk. */
  readonly ref: string;
  /** Producing tool, e.g. "github/list_commits". */
  readonly tool: string;
  /** The full, uncompressed result value as the tool returned it. */
  readonly value: unknown;
  /** When stored (for recency / eviction policy later). */
  readonly storedAt: number;
}

/** System-side store. NOT a model-facing tool — read only by the ContextManager
 *  (for summaries) and the reference resolver (for materialization). */
export class ResultStore {
  private readonly map = new Map<string, StoredResult>();
  private seq = 0;

  /** Store a result, return its stable ref. Ref is derived from the tool name +
   *  a monotonic counter so it is deterministic and human-legible. */
  put(tool: string, value: unknown): string {
    const base = tool.split("/").pop() ?? tool;
    const slug = base.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    const ref = `${slug}_${++this.seq}`;
    this.map.set(ref, { ref, tool, value, storedAt: Date.now() });
    return ref;
  }

  get(ref: string): StoredResult | undefined {
    return this.map.get(ref);
  }

  has(ref: string): boolean {
    return this.map.has(ref);
  }

  /** A short, model-facing SYSTEM SUMMARY of a stored result — count + schema +
   *  the ref. NO bulk data, NO `[STORED:]` marker, NO recall hint. This is what
   *  the model sees in place of the result body. */
  summarize(ref: string): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    const shape = describeShape(s.value);
    return `[stored as result_ref="${ref}"] ${s.tool} succeeded: ${shape}. The full data is held in the system store; reference it by id "${ref}".`;
  }

  /** Deterministically render a stored result into the requested shape. This is
   *  the materialization that fills a deliverable — ALL items, no truncation. */
  materialize(ref: string, format: ResultFormat = "bullets"): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    return renderValue(s.value, format);
  }
}
