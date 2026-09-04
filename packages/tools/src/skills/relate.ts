import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export interface RelateEntry {
  readonly id: string;
  readonly preview: string;
  readonly strength?: number;
  readonly type?: string;
}

/**
 * Dependency-injected port `relate` is built against — the handler never
 * imports `@reactive-agents/memory` directly (mirrors how find/recall take
 * a state object rather than a concrete store implementation). The kernel
 * wires this from the `AgentMemory` port's optional `getRelated` method
 * (see `packages/core/src/services/agent-memory.ts`), so `relate` is only
 * ever registered when a memory adapter that actually maintains a link
 * graph is present.
 */
export interface RelateState {
  readonly getRelated: (
    id: string,
    mode: "links" | "traverse",
    depth: number,
  ) => Effect.Effect<readonly RelateEntry[], unknown>;
}

const MAX_ENTRIES = 30;

export const relateTool: ToolDefinition = {
  name: "relate",
  description:
    "Explore the knowledge graph connecting stored memory entries — entries are auto-linked by " +
    "content similarity as memory is written. Use this to discover context related to a memory " +
    "entry that a keyword search (find/recall) would not surface directly. " +
    "mode 'links' (default): the entry's direct neighbors, with relationship strength (0-1) and type. " +
    "mode 'traverse': every entry reachable within `depth` hops, for broader context discovery. " +
    "Returns { id, mode, entries: [{ id, preview, strength?, type? }] }.",
  parameters: [
    {
      name: "id",
      type: "string",
      description:
        "Memory entry ID to explore from — typically an id seen in a prior recall() or find() result.",
      required: true,
    },
    {
      name: "mode",
      type: "string",
      description: "'links' (direct neighbors, default) or 'traverse' (multi-hop reachable set).",
      required: false,
      default: "links",
    },
    {
      name: "depth",
      type: "number",
      description: "Hops to traverse when mode is 'traverse'. Default: 2, max: 5.",
      required: false,
      default: 2,
    },
  ],
  returnType:
    "{ id: string, mode: string, entries: { id: string, preview: string, strength?: number, type?: string }[], truncated: boolean }",
  category: "data",
  riskLevel: "low",
  timeoutMs: 10_000,
  requiresApproval: false,
  source: "builtin",
  produces: "none",
};

export const makeRelateHandler =
  (state: RelateState) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const id = args.id as string | undefined;
      if (!id || typeof id !== "string") {
        return yield* Effect.fail(
          new ToolExecutionError({ message: 'relate requires an "id" parameter', toolName: "relate" }),
        );
      }
      const mode: "links" | "traverse" = args.mode === "traverse" ? "traverse" : "links";
      const depth =
        typeof args.depth === "number" && args.depth > 0
          ? Math.min(5, Math.floor(args.depth))
          : 2;

      const entries = yield* state.getRelated(id, mode, depth).pipe(
        Effect.catchAll((e) =>
          Effect.fail(
            new ToolExecutionError({
              message: `Relate lookup failed for "${id}": ${e instanceof Error ? e.message : String(e)}`,
              toolName: "relate",
              cause: e,
            }),
          ),
        ),
      );

      return {
        id,
        mode,
        entries: entries.slice(0, MAX_ENTRIES),
        truncated: entries.length > MAX_ENTRIES,
      };
    });
