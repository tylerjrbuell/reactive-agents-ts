/**
 * Typed current turn for gateway chat runs.
 *
 * The gateway folds history and framing into one enriched instruction string
 * (`buildEnrichedInstruction`) and hands the run an event, not a task. The
 * chat manager stamps the user's actual message on the event's metadata (the
 * same carrier `outboundServer` uses); `makeExecuteEvent` reads it back onto
 * `task.metadata.currentTurn`, so intent readers see the message, not the frame.
 */
import type { TaskCurrentTurn } from "@reactive-agents/core";

/** Event-metadata key that carries the typed current turn. */
export const EVENT_CURRENT_TURN_KEY = "currentTurn";

/**
 * Copy of `event` with the current turn stamped on its metadata. A non-object
 * event (nothing to carry it on) is returned unchanged.
 */
export const stampCurrentTurn = (event: unknown, turn: TaskCurrentTurn): unknown => {
    if (typeof event !== "object" || event === null) return event;
    const meta = (event as { metadata?: unknown }).metadata;
    const base = typeof meta === "object" && meta !== null ? meta : {};
    return { ...event, metadata: { ...base, [EVENT_CURRENT_TURN_KEY]: turn } };
};

/** Spread-ready `{ currentTurn }` read back off an event stamped by {@link stampCurrentTurn}; `{}` otherwise. */
export const currentTurnFromEvent = (event: unknown): { currentTurn?: TaskCurrentTurn } => {
    const meta = (event as { metadata?: Record<string, unknown> } | null | undefined)?.metadata;
    const turn = meta?.[EVENT_CURRENT_TURN_KEY] as { content?: unknown; priorTurnCount?: unknown } | undefined;
    if (turn === undefined || turn === null || typeof turn.content !== "string") return {};
    return {
        currentTurn: {
            content: turn.content,
            ...(typeof turn.priorTurnCount === "number" ? { priorTurnCount: turn.priorTurnCount } : {}),
        },
    };
};
