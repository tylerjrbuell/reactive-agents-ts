/**
 * Node.js server adapter — implemented in Task 3.
 * Wraps node:http behind ServerAdapter.
 */
import type { ServerAdapter } from "../types.js";

export function createNodeServer(): ServerAdapter {
  throw new Error(
    "Node.js server adapter is not yet implemented. " +
      "Install @reactive-agents/platform with Node.js support (Task 3).",
  );
}
