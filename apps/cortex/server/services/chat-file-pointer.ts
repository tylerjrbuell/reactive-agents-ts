/**
 * How a tagged workspace file reaches the agent: as a POINTER, not its contents.
 *
 * Inlining a whole file made every path mentioned inside it look like a request of the
 * person's, and spent context on text the agent may never need. A tagged file now arrives
 * as a delimited block that names the workspace path and size and tells the agent to read
 * the file when it needs it (the confined `file-read` tool). A file small enough to be no
 * heavier than the pointer itself is inlined inside the same delimited block.
 *
 * Path confinement and secret / binary refusal stay in `workspace-files.ts`
 * (`readWorkspaceText`); this module only words the block. Pure.
 */
import { formatBytes } from "@reactive-agents/ui-core";

/** A tagged file of at most this many bytes is placed in the prompt whole; a larger one is a pointer. */
export const POINTER_INLINE_MAX_BYTES = 2048;

/**
 * Closing line of an attached-file block. The framework's current-turn masking
 * (kernel `current-turn.ts`) matches this EXACT line (capital E); an unterminated
 * block masks to the end of the text, so never change the case or spacing.
 */
export const ATTACHED_FILE_END = "--- End attached file ---";

/** Opening line of an attached-file block (`--- Attached file: <path> (<size>) ---`). */
export function attachedFileHeader(path: string, totalBytes: number): string {
  return `--- Attached file: ${path} (${formatBytes(totalBytes)}) ---`;
}

/** The pointer sentence: where the file is and how to read it. Never the contents. */
export function pointerSentence(path: string): string {
  return `Workspace path ./${path}. The contents are not included here; read the file with file-read if you need them.`;
}

/**
 * The prompt block for one tagged workspace file. `text` is the file's whole text when it
 * is small enough to inline ({@link POINTER_INLINE_MAX_BYTES}), otherwise it is ignored.
 */
export function workspaceFileBlock(args: { readonly path: string; readonly totalBytes: number; readonly text: string }): string {
  const body = args.totalBytes <= POINTER_INLINE_MAX_BYTES ? `\`\`\`\n${args.text}\n\`\`\`` : pointerSentence(args.path);
  return `${attachedFileHeader(args.path, args.totalBytes)}\n${body}\n${ATTACHED_FILE_END}`;
}
