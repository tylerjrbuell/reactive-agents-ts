import { Data } from "effect";

/**
 * Raised when a chat turn requests an execution path whose capability the host
 * did not inject on the {@link ../chat/engine.ts!ChatEngine} capabilities bag.
 *
 * This is the canonical rejection for capability-miswired chat hosts: a tool
 * request (`useTools: true`) must NEVER silently fall back to the direct path —
 * silently rerouting an agentic request out of the reasoning loop would
 * quietly degrade behavior instead of surfacing the misconfiguration.
 *
 * Pattern per `packages/runtime/src/errors.ts` conventions
 * (`Data.TaggedError`); never a raw untagged `Error` literal, so the
 * package error pool does not rise.
 */
export class ChatEngineCapabilityError extends Data.TaggedError("ChatEngineCapabilityError")<{
  /** Human-readable error description; names the missing capability. */
  readonly message: string;
  /** The name of the missing capability (e.g. `"runTask"`, `"runStreamTask"`). */
  readonly capability: string;
}> {}
