/**
 * Run slots owned by `@reactive-agents/tools` (Plan 9 item 1R), for the
 * framework's run entry to bind with `withRunScope` / `childRunScope` from
 * `@reactive-agents/core/internal/run-scope`.
 *
 * Internal: exposed only as the `@reactive-agents/tools/internal/run-slots`
 * subpath, never from the package index, so the run-scope API stays internal.
 */
export { runToolStoresSlot, makeRunToolStoresSync } from "../skills/run-tool-stores.js";
export { documentStoreSlot } from "../skills/document-store.js";
export { fileRootSlot, capturedFileRoot } from "../skills/file-root.js";
