/**
 * Shared settings store — reads/writes localStorage, used by stage prompt,
 * builder form, runner service, and settings page.
 *
 * Settings are initialised lazily (on first read) so they work in SSR/build
 * contexts where localStorage is unavailable.
 */
import { writable, get } from "svelte/store";

export interface CortexSettings {
  defaultProvider: string;
  defaultModel: string;
  notificationLevel: "all" | "completions" | "failures" | "none";
  notificationsEnabled: boolean;
  runRetentionDays: number;
  debugMode: boolean;
}

export const DEFAULTS: CortexSettings = {
  defaultProvider: "anthropic",
  defaultModel: "claude-sonnet-4-6",
  notificationLevel: "completions",
  notificationsEnabled: false,
  runRetentionDays: 30,
  debugMode: false,
};

const STORAGE_KEY = "cortex-settings";

function load(): CortexSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<CortexSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function createSettingsStore() {
  const store = writable<CortexSettings>(DEFAULTS);
  let initialised = false;

  function init() {
    if (initialised) return;
    initialised = true;
    store.set(load());
  }

  function save(patch: Partial<CortexSettings>) {
    store.update((s) => {
      const next = { ...s, ...patch };
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch { /* storage quota */ }
      }
      return next;
    });
  }

  function reset() {
    store.set({ ...DEFAULTS });
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  return {
    subscribe: store.subscribe,
    /** Call once when the component/store mounts in the browser. */
    init,
    save,
    reset,
    get: () => get(store),
  };
}

export const settings = createSettingsStore();

/** Convenience: read the current default provider without subscribing. */
export function getDefaultProvider(): string {
  return settings.get().defaultProvider;
}

/** Convenience: read the current default model without subscribing. */
export function getDefaultModel(): string {
  return settings.get().defaultModel;
}
