/**
 * interaction-watcher.ts — app-wide durable-HITL `request_user_input` prompts.
 *
 * Polls `/api/runs/pending-interactions` and exposes the current set of pending
 * interactions through a shared `writable` store. Unlike `approval-watcher.ts`
 * (which raises a yes/no toast), interactions can require richer input (choice,
 * confirmation, form) — so instead of a toast we surface a panel-readable store
 * that `InteractPanel.svelte` subscribes to and renders controls for. Resolving
 * an interaction (via `respondToInteraction` / `createInteractions`) clears it
 * from the server-side registry; the next poll removes it here.
 */
import { writable } from "svelte/store";
import type { PendingInteractionWire } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "../constants.js";

const keyFor = (i: Pick<PendingInteractionWire, "runId" | "interactionId">) =>
  `interaction:${i.runId}|${i.interactionId}`;

/** Shared store of currently-pending interactions, updated by the poll loop. */
export const pendingInteractions = writable<PendingInteractionWire[]>([]);

/**
 * Start polling for pending `request_user_input` interactions. Returns a stop fn.
 */
export function startInteractionWatcher(pollMs = 2500): () => void {
  const seen = new Set<string>();

  async function poll(): Promise<void> {
    let interactions: PendingInteractionWire[] = [];
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/pending-interactions`);
      if (!res.ok) return;
      interactions =
        ((await res.json()) as { interactions?: PendingInteractionWire[] }).interactions ?? [];
    } catch {
      return;
    }

    pendingInteractions.set(interactions);

    const active = new Set(interactions.map(keyFor));
    for (const key of [...seen]) {
      if (!active.has(key)) seen.delete(key);
    }
    for (const i of interactions) seen.add(keyFor(i));
  }

  void poll();
  const timer = setInterval(() => void poll(), pollMs);
  return () => clearInterval(timer);
}
