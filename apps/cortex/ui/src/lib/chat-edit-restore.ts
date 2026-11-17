/**
 * Tagged files in a sent message: what Edit puts back in the composer and what the transcript
 * shows as chips. A tag is stored with its message as attachment metadata (workspace path and
 * size); when a message carries only the attached-file block the server writes into the task
 * (`--- Attached file: <path> (<size>) ---` ... `--- End attached file ---`; an older lowercase `end` still parses), the tags are
 * recovered from that block and the block never shows as text. Pure.
 */
import type { AttachmentMeta } from "@reactive-agents/ui-core";

/** A tagged workspace file: what the composer chip needs. */
export interface TaggedFile {
  readonly path: string;
  readonly bytes: number;
}

/** The minimum of a transcript turn these rules read. */
export interface TurnLike {
  readonly id: number;
  readonly role: string;
  readonly content: string;
  readonly attachments?: readonly AttachmentMeta[] | undefined;
}

const BLOCK = /\n*--- Attached file: (.+?) \(([^)]+)\) ---\n[\s\S]*?\n--- [Ee]nd attached file ---/g;
const UNIT: Readonly<Record<string, number>> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

/** `23 KB` -> bytes (approximate: sizes are shown rounded). */
export function bytesOfLabel(label: string): number {
  const m = /^([\d.]+)\s*(B|KB|MB|GB)$/.exec(label.trim());
  return m ? Math.round(Number(m[1]) * (UNIT[m[2]!] ?? 1)) : 0;
}

/** The text without attached-file blocks, and the files those blocks named. */
export function splitAttachedFiles(content: string): { readonly text: string; readonly files: readonly TaggedFile[] } {
  const files: TaggedFile[] = [];
  const text = content.replace(BLOCK, (_m, path: string, size: string) => {
    files.push({ path, bytes: bytesOfLabel(size) });
    return "";
  });
  return { text: files.length > 0 ? text.trim() : content, files };
}

/** The tagged files (workspace paths) among attachment metadata. */
export function taggedFilesOf(attachments: readonly AttachmentMeta[] | undefined): readonly TaggedFile[] {
  return (attachments ?? []).flatMap((a) => (a.kind === "workspace-file" && a.path ? [{ path: a.path, bytes: a.bytes }] : []));
}

/** What a user bubble shows: the typed text (no attached-file block) and its attachment chips. */
export function userTurnView(turn: Pick<TurnLike, "content" | "attachments">): { readonly text: string; readonly attachments: readonly AttachmentMeta[] } {
  const { text, files } = splitAttachedFiles(turn.content);
  const stored = turn.attachments ?? [];
  const recovered: AttachmentMeta[] = files
    .filter((f) => !stored.some((a) => a.path === f.path))
    .map((f) => ({ kind: "workspace-file", name: f.path.slice(f.path.lastIndexOf("/") + 1), path: f.path, bytes: f.bytes }));
  return { text, attachments: [...stored, ...recovered] };
}

/** The tags of the user message that `turnId` belongs to (an assistant id walks back to its user message). */
export function tagsOfTurn(turns: readonly TurnLike[], turnId: number): readonly TaggedFile[] {
  const at = turns.findIndex((t) => t.id === turnId);
  let i = at;
  while (i > 0 && turns[i]!.role !== "user") i--;
  const turn = at >= 0 ? turns[i] : undefined;
  if (!turn || turn.role !== "user") return [];
  return taggedFilesOf(userTurnView(turn).attachments);
}

/**
 * Edit & resend: put the rewound message back in the composer without any attached-file block,
 * and its tags back as chips. `before` is the turn list from BEFORE the rewind removed them.
 */
export function restoreEdit(
  before: readonly TurnLike[],
  turnId: number,
  rewoundText: string,
  putText: (text: string) => void,
  tag: (file: TaggedFile) => void,
): void {
  putText(splitAttachedFiles(rewoundText).text);
  for (const f of tagsOfTurn(before, turnId)) tag(f);
}
