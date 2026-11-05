/**
 * Run-entry file-root binding.
 *
 * File tools resolve relative paths against the active file root
 * (`@reactive-agents/tools` `skills/file-root.ts`). Plain-JS callers set it
 * with `withFileRoot(root, () => agent.run(...))`, which lives in
 * AsyncLocalStorage. Effect's scheduler does not keep that store: it resumes
 * fibers in the ALS context of whichever fiber started the drain, so after a
 * yield a run fiber could see no root and write relative to `process.cwd()`.
 *
 * {@link bindCallerFileRoot} pins the caller's root into `FileRootRef` (a
 * FiberRef, inherited by every forked fiber) when a run effect is BUILT. Call
 * it synchronously where a run entry builds its effect, so the root that is
 * active at the call site is the one captured.
 */
import { Effect, Fiber, Option } from "effect";
import { FileRootRef, bindFileRoot } from "@reactive-agents/tools";

/**
 * Bind the file root active at the call site onto `effect` and every fiber it
 * forks.
 *
 * Resolution: when called from inside a running fiber whose `FileRootRef` is
 * bound (e.g. a facade that resumes a durable run), that root wins. Otherwise
 * the AsyncLocalStorage root of the caller is captured. With neither, `effect`
 * is returned unchanged and file tools keep their `process.cwd()` default.
 */
export const bindCallerFileRoot = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  const fiber = Fiber.getCurrentFiber();
  const fiberRoot = Option.isSome(fiber) ? fiber.value.getFiberRef(FileRootRef) : undefined;
  return bindFileRoot(effect, fiberRoot);
};
