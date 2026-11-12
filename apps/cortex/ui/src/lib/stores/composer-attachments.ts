/**
 * The composer's attachment chips for one chat panel: add files (picker, drop, paste),
 * tag workspace files, remove, and hand the set to the send. Rules: `composer-attachments.ts`.
 *
 * Picture thumbnails of sent messages are kept for the page's lifetime (`thumbOf`) so the
 * transcript shows the picture the user sent; after a reload the turn shows its chip
 * (the server stores names and sizes, never bytes).
 */
import { writable, get, type Readable } from "svelte/store";
import type { InputCapabilitiesLike } from "@reactive-agents/ui-core";
import { addTagged, admit, bytesToBase64, type DraftAttachment } from "../composer-attachments.js";

const thumbs = new Map<string, string>();
const thumbKey = (name: string, bytes: number) => `${name}\u0000${bytes}`;

/** The thumbnail data URL of a picture sent in this page session, if kept. */
export function thumbOf(name: string, bytes: number): string | undefined {
  return thumbs.get(thumbKey(name, bytes));
}

/** Remember thumbnails of the chips being sent. */
export function keepThumbs(items: readonly DraftAttachment[]): void {
  for (const i of items) if (i.thumb) thumbs.set(thumbKey(i.name, i.bytes), i.thumb);
}

/** What the controller needs from its host. */
export interface AttachDeps {
  /** The session model's input capabilities (undefined = unknown, all allowed). */
  readonly caps: () => InputCapabilitiesLike | undefined;
  readonly model: () => string;
  /** Show a refusal. */
  readonly refuse: (title: string, message: string) => void;
}

/** The chips and the actions on them. */
export interface AttachController {
  readonly items: Readable<readonly DraftAttachment[]>;
  addFiles(files: readonly File[]): Promise<void>;
  addWorkspaceFile(file: { readonly path: string; readonly bytes: number }): void;
  remove(id: string): void;
  /** The current chips; empties the composer. */
  take(): readonly DraftAttachment[];
  clear(): void;
}

let seq = 0;
const nextId = () => `att-${Date.now().toString(36)}-${++seq}`;

/** A controller for one composer. */
export function createAttachController(deps: AttachDeps): AttachController {
  const store = writable<readonly DraftAttachment[]>([]);
  return {
    items: { subscribe: store.subscribe },
    async addFiles(files) {
      for (const file of files) {
        const verdict = admit(get(store), { name: file.name || "pasted", mediaType: file.type, bytes: file.size }, deps.caps(), deps.model());
        if (!verdict.ok) {
          deps.refuse("Not attached", verdict.reason);
          continue;
        }
        const dataBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
        const item: DraftAttachment = {
          id: nextId(),
          kind: verdict.kind,
          name: file.name || (verdict.kind === "image" ? "pasted-image.png" : "pasted"),
          bytes: file.size,
          mediaType: verdict.mediaType,
          dataBase64,
          ...(verdict.kind === "image" ? { thumb: `data:${verdict.mediaType};base64,${dataBase64}` } : {}),
        };
        store.update((items) => [...items, item]);
      }
    },
    addWorkspaceFile(file) {
      const r = addTagged(get(store), file, nextId());
      if (r.error) deps.refuse("Not attached", r.error);
      else store.set(r.items);
    },
    remove(id) {
      store.update((items) => items.filter((i) => i.id !== id));
    },
    take() {
      const items = get(store);
      store.set([]);
      return items;
    },
    clear() {
      store.set([]);
    },
  };
}
