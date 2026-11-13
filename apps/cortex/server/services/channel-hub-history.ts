/**
 * Empties one conversation's PERSISTED chat history for a hub agent.
 *
 * A channel session is opened with `persist: true`, so its messages live in the agent's own memory
 * database (the memory package's `SessionStoreService`, table `chat_sessions`, keyed by the session id
 * `<routeId>:<role>:<conversationKey>`). Owner `/new` has to clear that row, otherwise the next turn
 * reloads the stale history. The store has no delete, so this upserts an empty message list, which is
 * what a later `load` reads back as "no history". A store failure REJECTS: the caller must know the
 * history was not cleared (the router then tells the owner, instead of claiming a fresh start).
 *
 * An agent built without memory has no store: nothing was persisted, so there is nothing to clear.
 */
import { Effect } from "effect";
import type { ManagedRuntime } from "effect";
import { SessionStoreService } from "@reactive-agents/memory";

/** The slice of a built agent this needs (a `ReactiveAgent` satisfies it). */
export interface HistoryHolder {
  readonly agentId: string;
  readonly runtime: ManagedRuntime.ManagedRuntime<unknown, never>;
}

/** Empty the persisted history of `sessionId` on `agent`. Rejects when the store fails. */
export const clearPersistedHistory = (agent: HistoryHolder, sessionId: string): Promise<void> =>
  agent.runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* Effect.serviceOption(SessionStoreService);
      if (store._tag !== "Some") return;
      yield* store.value.save({ sessionId, agentId: agent.agentId, messages: [] });
    }),
  );
