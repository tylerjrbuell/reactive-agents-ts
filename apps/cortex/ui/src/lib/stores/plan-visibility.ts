import { writable } from "svelte/store";

const KEY = "cortex.chat.planHidden";
const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** True when the user hid the plan card and to-do dock with `/plan`. A per-viewer convenience only. */
export const planHidden = writable<boolean>(read());

/** Flip visibility; returns the new hidden state. */
export function togglePlan(current: boolean): boolean {
  const next = !current;
  planHidden.set(next);
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* storage unavailable: the toggle still works for this visit */
  }
  return next;
}
