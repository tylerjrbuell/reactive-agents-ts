/**
 * Promise-based confirmation dialog. One host (`ConfirmHost`, mounted in the root
 * layout) renders the pending request, so call sites read as:
 *
 *   if (!(await confirmAction({ title: "Delete tool?", message: name }))) return;
 *
 * Only one dialog is open at a time; a request that arrives while another is
 * pending resolves the older one as cancelled first.
 */
import { writable } from "svelte/store";

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** "danger" for destructive actions (default), "primary" otherwise. */
  readonly variant?: "danger" | "primary";
}

interface PendingConfirm extends ConfirmRequest {
  readonly resolve: (ok: boolean) => void;
}

export const pendingConfirm = writable<PendingConfirm | null>(null);

/** Open the dialog and resolve `true` on confirm, `false` on cancel / Escape / backdrop. */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    pendingConfirm.update((prev) => {
      prev?.resolve(false);
      return { ...request, resolve };
    });
  });
}

/** Close the current dialog with the given answer. */
export function settleConfirm(ok: boolean): void {
  pendingConfirm.update((prev) => {
    prev?.resolve(ok);
    return null;
  });
}
