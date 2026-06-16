/**
 * Toast notification store.
 *
 * Usage:
 *   import { toast } from "$lib/stores/toast-store.js";
 *   toast.success("Agent completed");
 *   toast.error("Run failed: timeout");
 *   toast.info("Connected to cortex");
 */
import { writable } from "svelte/store";

export type ToastKind = "success" | "error" | "warning" | "info" | "connection";

/** An interactive button rendered inside a toast (e.g. Approve / Deny). */
export interface ToastButton {
  readonly label: string;
  readonly variant?: "primary" | "danger" | "ghost";
  readonly onClick: () => void | Promise<void>;
  /** Dismiss the toast after onClick (default true). */
  readonly closeOnClick?: boolean;
}

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly title: string;
  readonly message?: string;
  readonly durationMs: number;
  readonly action?: { label: string; href: string };
  /** Interactive buttons (callbacks). Used by approval prompts. */
  readonly buttons?: readonly ToastButton[];
  /** Stable key — a later prompt with the same key replaces (de-dupes) the toast. */
  readonly key?: string;
}

function makeToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  function add(toast: Omit<Toast, "id">): string {
    const id = crypto.randomUUID();
    update((ts) => {
      // De-dupe by key: a later prompt with the same key replaces the earlier one.
      const base = toast.key ? ts.filter((t) => t.key !== toast.key) : ts;
      return [...base, { ...toast, id }];
    });
    if (toast.durationMs > 0) {
      setTimeout(() => remove(id), toast.durationMs);
    }
    return id;
  }

  /** Remove any toast carrying the given key (e.g. when an approval is resolved elsewhere). */
  function removeByKey(key: string) {
    update((ts) => ts.filter((t) => t.key !== key));
  }

  function remove(id: string) {
    update((ts) => ts.filter((t) => t.id !== id));
  }

  return {
    subscribe,
    remove,
    removeByKey,

    /**
     * Interactive prompt toast (sticky by default) with callback buttons.
     * Returns the toast id. Use `key` to de-dupe / later dismiss via removeByKey.
     */
    prompt: (opts: {
      kind?: ToastKind;
      title: string;
      message?: string;
      buttons: readonly ToastButton[];
      durationMs?: number;
      key?: string;
    }) =>
      add({
        kind: opts.kind ?? "warning",
        title: opts.title,
        message: opts.message,
        durationMs: opts.durationMs ?? 0,
        buttons: opts.buttons,
        key: opts.key,
      }),

    success: (title: string, message?: string, action?: Toast["action"]) =>
      add({ kind: "success", title, message, durationMs: 4000, action }),

    error: (title: string, message?: string, action?: Toast["action"]) =>
      add({ kind: "error", title, message, durationMs: 7000, action }),

    warning: (title: string, message?: string) =>
      add({ kind: "warning", title, message, durationMs: 5000 }),

    info: (title: string, message?: string, action?: Toast["action"]) =>
      add({ kind: "info", title, message, durationMs: 4000, action }),

    connection: (title: string, message?: string, action?: Toast["action"]) =>
      add({ kind: "connection", title, message, durationMs: 5000, action }),

    permanent: (kind: ToastKind, title: string, message?: string) =>
      add({ kind, title, message, durationMs: 0 }),
  };
}

export const toast = makeToastStore();
