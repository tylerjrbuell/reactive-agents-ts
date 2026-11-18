/**
 * The run's kernel turn count: the number behind `metadata.iterations`.
 *
 * A run is not a pass. The engine can run reasoning several times in one run:
 * the primary pass (`reasoning-think.ts`), the post-think continuations
 * (`reasoning-harness-hooks.ts`: withMinIterations, customTermination,
 * validator, reflect-REVISE) and the verification retry
 * (`verification-think-retry.ts`). Each later pass overwrites
 * `ctx.metadata.reasoningResult`, so reading the last pass's count would drop
 * the earlier passes' turns. Each pass site adds its turns here instead.
 *
 * A pass's turns are `metadata.kernelIterations`: the kernel's own
 * `state.iteration`, summed by `@reactive-agents/reasoning` over the pass's
 * kernel runs. A pass with no kernel run (a custom or mocked ReasoningService)
 * counts as 1 turn: it made at least one model call. The fallback is never the
 * reasoning step count (`stepsCount`). Steps count every thought, action and
 * observation, so they over-count turns (2026-11-18 extra-iterations
 * diagnosis: 9-13 reported "iterations" for 3-5 real turns).
 */

/** The engine-context metadata key the run's kernel turns accumulate under. */
export const RUN_KERNEL_TURNS_KEY = "runKernelTurns";

/** The slice of a normalized reasoning result this seam reads. */
export interface PassTurnsSource {
  readonly metadata?: { readonly kernelIterations?: number };
}

/** True when the pass ran at least one kernel turn (a kernel strategy ran it). */
export function passRanKernel(pass: PassTurnsSource | null | undefined): boolean {
  const k = pass?.metadata?.kernelIterations;
  return typeof k === "number" && Number.isFinite(k);
}

/** One pass's turns: its kernel count, or 1 when no kernel ran it. */
export function passKernelTurns(pass: PassTurnsSource | null | undefined): number {
  const k = pass?.metadata?.kernelIterations;
  return typeof k === "number" && Number.isFinite(k) ? k : 1;
}

/** The run's kernel turns so far, or undefined before any pass was counted. */
export function readRunKernelTurns(
  metadata: Readonly<Record<string, unknown>> | undefined,
): number | undefined {
  const value = metadata?.[RUN_KERNEL_TURNS_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The metadata patch a pass site spreads into the context it returns:
 *
 *   metadata: { ...ctx.metadata, reasoningResult: r,
 *               ...addedRunKernelTurns(ctx.metadata, r) }
 *
 * The primary pass starts the count (no prior value); every later pass adds to it.
 */
export function addedRunKernelTurns(
  ctxMetadata: Readonly<Record<string, unknown>> | undefined,
  pass: PassTurnsSource | null | undefined,
): Readonly<Record<string, number>> {
  return { [RUN_KERNEL_TURNS_KEY]: (readRunKernelTurns(ctxMetadata) ?? 0) + passKernelTurns(pass) };
}
