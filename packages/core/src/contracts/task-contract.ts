/**
 * TaskContract — the typed contract a bench task or production-agent task
 * declares so the builder + runner can validate before any LLM round-trip.
 *
 * Replaces ad-hoc fields like `requiresTools: true` (boolean) with an
 * explicit shape: which tools must be REQUIRED to call, which must be
 * AVAILABLE to call, which must be FORBIDDEN. Fixtures, model-capability
 * floor, success criterion, and optional output shape all expressed as
 * machine-checkable types.
 *
 * Companion spec: [[2026-06-02-canonical-contracts-and-invariants]] §2.1.
 * First contract in the Sprint-1 typed-contract foundation (north-star §6.5).
 *
 * @example
 *   const summarizeTask: TaskContract = {
 *     prompt: "Read report.md and write '## Summary' with one line per section.",
 *     tools: [{ kind: "required", name: "file-read" }],
 *     fixtures: [{ path: "report.md", content: bigReport }],
 *     success: { type: "regex", pattern: "## Summary" },
 *     outputShape: { format: "markdown", mustInclude: ["## Summary"] },
 *   };
 */

/**
 * A single tool's relationship to the task.
 *
 *  - `required` — the task is expected to call this tool at least once. Builder
 *    validates the tool is registered; preflight validates it's visible to the
 *    LLM via the schema-facing tool list.
 *  - `available` — the tool MUST be visible to the LLM but is not required to
 *    be called. Use for optional secondary tools (e.g., `find` alongside
 *    a primary `file-read`).
 *  - `forbidden` — the tool MUST NOT be visible to the LLM. Use to constrain
 *    safe-behavior tasks (no `shell-execute` for a docs task, etc.).
 */
export type ToolRequirement =
  | { readonly kind: "required"; readonly name: string }
  | { readonly kind: "available"; readonly name: string }
  | { readonly kind: "forbidden"; readonly name: string };

/**
 * A fixture file the runner must materialize before running the task.
 * Runner writes `content` to a working-directory copy of `path`. The
 * `readableVia` list is optional — when omitted, fixtures default to
 * requiring `file-read` exposure.
 */
export interface FixtureContract {
  readonly path: string;
  readonly content: string;
  readonly readableVia?: readonly string[];
}

/**
 * Minimum model capability the task expects. Builder fails preflight if
 * the resolved capability doesn't meet the floor.
 */
export interface ModelFloor {
  /** Effective context window (chars, ~65% of claimed window). */
  readonly window?: number;
  /** Requires the model to support native thinking-mode. */
  readonly thinking?: boolean;
  /** Requires native function-calling dialect. */
  readonly nativeFC?: boolean;
}

/**
 * Success oracle for the task. Three forms:
 *  - `regex` — pattern (case-insensitive by convention) the output must match.
 *  - `llm-judge` — graded by the judge-server with a rubric and pass threshold.
 *  - `predicate` — a pure function from output → boolean (programmatic check).
 */
export type SuccessCriterion =
  | { readonly type: "regex"; readonly pattern: string }
  | {
      readonly type: "llm-judge";
      readonly rubric: string;
      readonly passThreshold?: number;
    }
  | { readonly type: "predicate"; readonly fn: (output: string) => boolean };

/**
 * Optional shaping for the deliverable. When present, preflight + verifier
 * can confirm the model's output matches the declared shape.
 */
export interface OutputContract {
  readonly format?: "prose" | "json" | "markdown";
  readonly mustInclude?: readonly string[];
}

/**
 * The canonical task contract. The runner / agent.build() / bench all read
 * from this single shape. Boolean ambiguity (`requiresTools: true`) is gone:
 * every required behavior is enumerated.
 */
export interface TaskContract {
  /** The agent's prompt — preserved verbatim. */
  readonly prompt: string;
  /** Tools the task declares it needs (required + available + forbidden). */
  readonly tools: readonly ToolRequirement[];
  /** Fixture files that must be readable at run time. */
  readonly fixtures?: readonly FixtureContract[];
  /** Minimum model capability this task expects. */
  readonly modelFloor?: ModelFloor;
  /** Success oracle. */
  readonly success: SuccessCriterion;
  /** Optional shaping for the deliverable. */
  readonly outputShape?: OutputContract;
}

/**
 * Extract the list of tool names a task explicitly declares as required or
 * available. Used by the bench runner to drive `.withTools({builtins:[...]})`
 * from a `TaskContract`. Fixtures default to requiring `file-read` if no
 * explicit tool requirement covers them.
 */
export function toolsToExpose(contract: TaskContract): readonly string[] {
  const names = new Set<string>();
  for (const t of contract.tools) {
    if (t.kind === "required" || t.kind === "available") names.add(t.name);
  }
  const hasFixture = (contract.fixtures?.length ?? 0) > 0;
  const hasFileRead = names.has("file-read");
  if (hasFixture && !hasFileRead) names.add("file-read");
  // Forbidden tools are filtered out separately at the builder; this helper
  // only computes what to expose. Caller intersects with the registered set.
  return [...names];
}
