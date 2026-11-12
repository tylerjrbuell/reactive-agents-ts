/**
 * Side questions (`/btw`) asked in this browser session, newest last. They live outside
 * the chat store's turns on purpose: an aside is never part of the chat's history or of
 * the running turn, so nothing here can change either.
 */
import { get, writable, type Readable } from "svelte/store";
import { askBtw, btwContextOf, settleAside, type BtwAside } from "../chat-btw.js";
import type { ChatTurn } from "./chat-store.js";

/** An aside with the chat it belongs to. */
export type SessionAside = BtwAside & { readonly sessionId: string };

/** Asides of one chat, in the order they were asked. */
export function asidesFor(all: readonly SessionAside[], sessionId: string): SessionAside[] {
  return all.filter((a) => a.sessionId === sessionId);
}

export interface BtwStore extends Readable<SessionAside[]> {
  /** Ask `question` about the chat's latest exchange; resolves when the answer (or error) is in. */
  ask(sessionId: string, question: string, turns: readonly ChatTurn[]): Promise<void>;
  /** Drop one aside. */
  dismiss(id: number): void;
}

/** A store; `ask` is injectable for tests. */
export function createBtwStore(send: typeof askBtw = askBtw): BtwStore {
  const { subscribe, update } = writable<SessionAside[]>([]);
  let next = 1;
  return {
    subscribe,
    async ask(sessionId, question, turns) {
      const context = btwContextOf(turns);
      const pending: SessionAside = { id: next++, sessionId, question, whileRunning: context?.running === true, status: "pending" };
      update((all) => [...all, pending]);
      const result = await send(sessionId, question, context);
      update((all) => all.map((a) => (a.id === pending.id ? { ...settleAside(a, result), sessionId } : a)));
    },
    dismiss(id) {
      update((all) => all.filter((a) => a.id !== id));
    },
  };
}

/** The app's side-question store. */
export const btwStore: BtwStore = createBtwStore();

/** Current value, for tests and one-off reads. */
export const btwSnapshot = (store: Readable<SessionAside[]>): SessionAside[] => get(store);
