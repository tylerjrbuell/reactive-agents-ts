/**
 * Entropy / reactive-controller shapes carried on `KernelMeta` (kernel-state.ts
 * re-exports both). Moved verbatim out of the pinned kernel-state.ts shell
 * (2026-11-06) so that shell stays under its ceiling.
 */
import type { EntropyScoreLike } from "../../kernel/loop/output-assembly.js";

/** Entropy sensor metadata accumulated during kernel execution. */
export interface KernelEntropyMeta {
  readonly taskDescription?: string;
  readonly modelId?: string;
  readonly providerName?: string;
  readonly temperature?: number;
  readonly taskCategory?: string;
  readonly lastLogprobs?: readonly { token: string; logprob: number; topLogprobs?: readonly { token: string; logprob: number }[] }[];
  readonly entropyHistory?: readonly EntropyScoreLike[];
  readonly controllerConfig?: {
    readonly earlyStop: boolean;
    readonly strategySwitch: boolean;
  };
  /** Latest entropy snapshot for brief/pulse meta-tools. */
  readonly latest?: { readonly composite: number; readonly shape: string; readonly momentum: number; readonly history?: readonly number[] };
  /** Latest composite score for termination oracle. */
  readonly latestScore?: unknown;
  /** Latest trajectory shape for termination oracle. */
  readonly latestTrajectory?: unknown;
}

/** Reactive controller decision stored on meta for oracle consumption. */
export interface ControllerDecisionLike {
  readonly decision: string;
  readonly reason?: string;
}
