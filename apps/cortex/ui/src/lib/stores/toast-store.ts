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

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly title: string;
  readonly message?: string;
  readonly durationMs: number;
  readonly action?: { label: string; href: string };
}

function makeToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  function add(toast: Omit<Toast, "id">): string {
    const id = crypto.randomUUID();
    update((ts) => [...ts, { ...toast, id }]);
    if (toast.durationMs > 0) {
      setTimeout(() => remove(id), toast.durationMs);
    }
    return id;
  }

  function remove(id: string) {
    update((ts) => ts.filter((t) => t.id !== id));
  }

  return {
    subscribe,
    remove,

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
