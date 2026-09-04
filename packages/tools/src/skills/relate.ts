import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export interface RelateEntry {
  readonly id: string;
  readonly preview: string;
  readonly strength?: number;
  readonly type?: string;
}

export const RELATE_LINK_TYPES = [
  "similar",
  "sequential",
  "causal",
  "contradicts",
  "supports",
  "elaborates",
] as const;
export type RelateLinkType = (typeof RELATE_LINK_TYPES)[number];

/**
 * Dependency-injected port `relate` is built against — the handler never
 * imports `@reactive-agents/memory` directly (mirrors how find/recall take
 * a state object rather than a concrete store implementation). The kernel
 * wires this from the `AgentMemory` port's optional `getRelated`/`link`
 * methods (see `packages/core/src/services/agent-memory.ts`), so each mode
 * is only ever offered when a memory adapter that actually supports it is
 * present. `link` is independently optional from `getRelated` — an adapter
 * could plausibly support reading a graph it didn't build (a read-only
 * import) without supporting writes to it.
 */
export interface RelateState {
  readonly getRelated: (
    id: string,
    mode: "links" | "traverse",
    depth: number,
  ) => Effect.Effect<readonly RelateEntry[], unknown>;
  readonly link?: (
    sourceId: string,
    targetId: string,
    type: RelateLinkType,
    strength?: number,
  ) => Effect.Effect<void, unknown>;
}

const MAX_ENTRIES = 30;

export const relateTool: ToolDefinition = {
  name: "relate",
  description:
    "Read or write the relationship graph connecting stored memory entries. " +
    "mode 'links' (default): the entry's direct neighbors, with relationship strength (0-1) and type. " +
    "mode 'traverse': every entry reachable within `depth` hops, for broader context discovery. " +
    "mode 'link': explicitly assert a relationship between two entries you've identified as connected — " +
    "requires `targetId`; `type` is one of similar/sequential/causal/contradicts/supports/elaborates " +
    "(default 'similar'). Use this when YOU notice a connection the auto-linker (content similarity) " +
    "wouldn't catch — e.g. two entries that contradict each other, or one that causally led to another. " +
    "Returns { id, mode, entries: [{ id, preview, strength?, type? }] } for links/traverse, " +
    "{ id, mode, linked: true, targetId, type, strength } for link.",
  parameters: [
    {
      name: "id",
      type: "string",
      description:
        "Memory entry ID to act on — typically an id seen in a prior recall() or find() result. " +
        "For mode 'link', this is the relationship's source.",
      required: true,
    },
    {
      name: "mode",
      type: "string",
      description: "'links' (direct neighbors, default), 'traverse' (multi-hop reachable set), or 'link' (create a relationship).",
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
    {
      name: "targetId",
      type: "string",
      description: "REQUIRED when mode is 'link' — the other entry ID to relate `id` to.",
      required: false,
    },
    {
      name: "type",
      type: "string",
      description:
        "Relationship type for mode 'link': similar | sequential | causal | contradicts | supports | elaborates. Default: 'similar'.",
      required: false,
      default: "similar",
    },
    {
      name: "strength",
      type: "number",
      description: "Confidence 0-1 for mode 'link'. Default: 1.0 (an explicit assertion is maximally confident).",
      required: false,
      default: 1.0,
    },
  ],
  returnType:
    "{ id: string, mode: string, entries?: { id: string, preview: string, strength?: number, type?: string }[], truncated?: boolean, linked?: boolean, targetId?: string, type?: string, strength?: number }",
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
      const mode: "links" | "traverse" | "link" =
        args.mode === "traverse" ? "traverse" : args.mode === "link" ? "link" : "links";

      if (mode === "link") {
        const targetId = args.targetId as string | undefined;
        if (!targetId || typeof targetId !== "string") {
          return yield* Effect.fail(
            new ToolExecutionError({
              message: 'relate mode "link" requires a "targetId" parameter',
              toolName: "relate",
            }),
          );
        }
        const rawType = typeof args.type === "string" ? args.type : "similar";
        if (!(RELATE_LINK_TYPES as readonly string[]).includes(rawType)) {
          return yield* Effect.fail(
            new ToolExecutionError({
              message: `relate mode "link": invalid type "${rawType}" — expected one of ${RELATE_LINK_TYPES.join(", ")}`,
              toolName: "relate",
            }),
          );
        }
        const type = rawType as RelateLinkType;
        const strength =
          typeof args.strength === "number" && args.strength >= 0 && args.strength <= 1
            ? args.strength
            : 1.0;

        if (!state.link) {
          return yield* Effect.fail(
            new ToolExecutionError({
              message: "relate mode \"link\" is not available — this memory adapter doesn't support creating relationships",
              toolName: "relate",
            }),
          );
        }

        yield* state.link(id, targetId, type, strength).pipe(
          Effect.catchAll((e) =>
            Effect.fail(
              new ToolExecutionError({
                message: `Relate link failed ("${id}" -> "${targetId}"): ${e instanceof Error ? e.message : String(e)}`,
                toolName: "relate",
                cause: e,
              }),
            ),
          ),
        );

        return { id, mode, linked: true, targetId, type, strength };
      }

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
