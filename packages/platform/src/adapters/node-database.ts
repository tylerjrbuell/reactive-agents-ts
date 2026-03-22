/**
 * Node.js database adapter — implemented in Task 3.
 * Wraps better-sqlite3 behind DatabaseAdapter.
 */
import type { DatabaseAdapter, DatabaseFactory } from "../types.js";

export function createNodeDatabase(
  _path: string,
  _options?: { create?: boolean; readonly?: boolean },
): DatabaseAdapter {
  throw new Error(
    "Node.js database adapter is not yet implemented. " +
      "Install @reactive-agents/platform with Node.js support (Task 3).",
  );
}
