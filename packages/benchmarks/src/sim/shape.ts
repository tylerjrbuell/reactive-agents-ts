/**
 * Phase Z: a Shape is one recurring failure situation, distilled from a real
 * source trace, that a scripted policy model can re-create deterministically.
 * Pure data plus a policy: running it needs the kernel test seam, so the runner
 * lives under `tests/sim/` (scripts/check-cross-cutting.sh forbids
 * `provideTestEnvelope` in production src).
 */
import type { PolicyModel } from "./policy-model.js";

/** A tool parameter as the kernel's tool schema declares it. */
export interface ShapeToolParam {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

/** What a scripted tool returns for one call. */
export type ToolOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string };

/** A scripted tool. `run` sees the call's args and its 0-based call index for this tool. */
export interface ShapeTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly ShapeToolParam[];
  readonly run: (args: Readonly<Record<string, unknown>>, callIndex: number) => ToolOutcome;
}

/** The outcome a perfect harness reaches on this shape. */
export interface Ideal {
  /** Kernel `terminatedBy` label (e.g. `final_answer`, `abstained`). */
  readonly terminatedBy: string;
  /** Reasoning result status. */
  readonly status: "completed" | "failed" | "partial" | "abstained";
  /** Tool names executed, in order. */
  readonly toolSeq: readonly string[];
  /** Agent (think) calls allowed. */
  readonly maxTurns: number;
}

/** Run-level settings a shape needs. */
export interface ShapeRun {
  readonly maxIterations: number;
  readonly requiredTools: readonly string[];
  /** Context tier: `local` shows the parallel-tool hint, `mid` already carries it. */
  readonly tier: "local" | "mid";
}

/** One failure shape. */
export interface Shape {
  readonly id: string;
  /**
   * Evidence this shape re-creates: a real trace id or an audit reference
   * (a bench task id plus the report/commit that documents the failure).
   */
  readonly sourceTraceId: string;
  readonly task: string;
  readonly tools: readonly ShapeTool[];
  /** The naive model: how it behaves with no help. Steering-aware via `obeys` (compliance.ts). */
  readonly policy: PolicyModel;
  readonly ideal: Ideal;
  readonly run: ShapeRun;
}
