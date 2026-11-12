/**
 * Wording and icons for attachment chips (composer bar and transcript). Pure.
 */
import { formatBytes, type AttachmentMeta } from "@reactive-agents/ui-core";
import type { IconName } from "./icons.js";

/** Icon for an attachment kind. */
export function attachmentIcon(kind: AttachmentMeta["kind"]): IconName {
  return kind === "image" ? "image" : kind === "audio" ? "mic" : "file";
}

/** `report.md · 12 KB`, with `64 KB of 340 KB sent` when only part of a file went. */
export function attachmentLabel(a: Pick<AttachmentMeta, "name" | "bytes" | "shownBytes">): string {
  return a.shownBytes !== undefined && a.shownBytes < a.bytes
    ? `${a.name} · ${formatBytes(a.shownBytes)} of ${formatBytes(a.bytes)} sent`
    : `${a.name} · ${formatBytes(a.bytes)}`;
}

/** One line for assistive tech and tooltips: kind, path or name, size. */
export function attachmentTitle(a: AttachmentMeta): string {
  const what = a.kind === "workspace-file" ? "Workspace file" : a.kind === "image" ? "Picture" : a.kind === "audio" ? "Audio" : "Text file";
  return `${what} ${a.path ?? a.name}, ${attachmentLabel(a).split(" · ").slice(1).join(" · ")}`;
}
