/**
 * The error `agent.run()` rejects with by default.
 *
 * It must print as ONE readable line when a user leaves the rejection uncaught
 * at a top-level await (a bad API key is the first failure most new users hit):
 *
 * - Built with `Error.stackTraceLimit = 0`, so it carries no frames. Bun's
 *   uncaught-error printer otherwise shows a source excerpt of the runtime file
 *   that constructed it.
 * - `name` and the constructor's `name` are both pinned to "AgentRunError".
 *   Node's inspector prints the constructor name when the two differ, and a
 *   bundler that renames the class (`_RunBoundaryError`) leaked into the output.
 * - `cause` is a prototype accessor, not an own property: Bun renders an own
 *   `cause` as a second source-frame block.
 *
 * The full unwrapped error (message with suggestion, the original tagged error
 * on its `_originalTaggedError`) stays reachable on `.cause` for programmatic
 * callers. Zero imports so the printing contract can be pinned under Node too.
 */
const fullErrors = new WeakMap<AgentRunError, Error>();

/** Public rejection type of `agent.run()`; `.cause` holds the full error. */
export class AgentRunError extends Error {
  /** The full unwrapped error behind this one-line message. */
  declare readonly cause: Error | undefined;

  /**
   * @param message - One-line message shown to the user.
   * @param full - The full error, exposed as `.cause`.
   */
  constructor(message: string, full: Error) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    try {
      super(message);
    } finally {
      Error.stackTraceLimit = limit;
    }
    fullErrors.set(this, full);
    // A frameless error has no `stack` under Bun; give callers the one line.
    this.stack = `AgentRunError: ${message}`;
  }
}

Object.defineProperty(AgentRunError, "name", { value: "AgentRunError", configurable: true });
Object.defineProperty(AgentRunError.prototype, "name", {
  value: "AgentRunError",
  writable: true,
  configurable: true,
});
Object.defineProperty(AgentRunError.prototype, "cause", {
  get(this: AgentRunError): Error | undefined {
    return fullErrors.get(this);
  },
  configurable: true,
});
