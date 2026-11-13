/**
 * A request from another Lab tab to open the Channels tab with a new route for an agent (the
 * "Add route" shortcut under a saved agent). The Channels tab takes it once when it mounts.
 */
import { get, writable } from "svelte/store";

/** The agent a new route should point at; null = nothing requested. */
export const channelsIntent = writable<{ readonly agentId: string } | null>(null);

/** Ask the Channels tab for a new route to `agentId`. */
export const requestNewRoute = (agentId: string): void => channelsIntent.set({ agentId });

/** Read and clear the request. */
export function takeNewRouteRequest(): { readonly agentId: string } | null {
  const v = get(channelsIntent);
  channelsIntent.set(null);
  return v;
}
