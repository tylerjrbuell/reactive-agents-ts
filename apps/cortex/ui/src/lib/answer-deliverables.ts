/**
 * What the deliverables strip shows and does for each item: label, size, which actions
 * apply (a deliverable the framework only declared has no content to preview, copy or
 * download). The derivation itself is ui-core `deliverablesOf`. Pure.
 */
import { deliverableFileName, formatBytes, type DeliverableItem, type DeliverableKind } from "@reactive-agents/ui-core";
import type { IconName } from "./icons.js";

/** Icon for a deliverable kind. */
export function deliverableIcon(kind: DeliverableKind): IconName {
  switch (kind) {
    case "image": return "image";
    case "diff": return "code";
    case "data": case "structured": return "list";
    default: return "file";
  }
}

/** What can be done with a deliverable. */
export interface DeliverableActions {
  readonly preview: boolean;
  readonly copy: boolean;
  readonly download: boolean;
}

/** Actions available: those need known content. */
export function deliverableActions(d: DeliverableItem): DeliverableActions {
  const has = d.content !== undefined && d.content !== "" && d.kind !== "image";
  return { preview: has, copy: has, download: has };
}

/** The meta line under a deliverable's name: kind words, size, and "cut" when its content was capped. */
export function deliverableMeta(d: DeliverableItem): string {
  const kind = d.missing ? "declared, not produced" : d.kind === "diff" ? "edit" : d.kind === "structured" ? "typed result" : d.kind === "declared" ? "declared" : d.kind;
  const size = d.contentChars !== undefined ? `${formatBytes(d.contentChars)}${d.truncated ? ", preview cut" : ""}` : "";
  return [kind, size].filter((s) => s !== "").join(" · ");
}

/** MIME type for downloading a deliverable. */
export function deliverableMime(d: DeliverableItem): string {
  return d.mediaType && d.mediaType !== "application/octet-stream" ? d.mediaType : "text/plain";
}

export { deliverableFileName };
