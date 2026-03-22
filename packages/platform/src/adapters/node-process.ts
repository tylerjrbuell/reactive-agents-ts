/**
 * Node.js process adapter — implemented in Task 3.
 * Wraps child_process behind ProcessAdapter.
 */
import type { ProcessAdapter } from "../types.js";

export function createNodeProcess(): ProcessAdapter {
  throw new Error(
    "Node.js process adapter is not yet implemented. " +
      "Install @reactive-agents/platform with Node.js support (Task 3).",
  );
}
