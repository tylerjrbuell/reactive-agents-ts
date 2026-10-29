import { writable } from "svelte/store";

/** Narrow-viewport (<768px) chat sessions drawer: open state, toggled from the app header. Not persisted. */
export const chatSidebarOpen = writable(false);
