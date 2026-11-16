/**
 * Rules for moving a plan in and out of the chat plan card: which export actions the menu offers,
 * and the sentence a failed import shows. The formats and their parsers are the framework's
 * (`@reactive-agents/core`, called by the server); this only words the menu and the failure. Pure.
 */
import type { PlanFormat, PlanParseReasonWire } from "./plan-api.js";

/** One row of the export menu. `copy` puts the text on the clipboard; `download` saves a file. */
export interface PlanExportItem {
  readonly key: string;
  readonly label: string;
  readonly format: PlanFormat;
  readonly action: "copy" | "download";
}

/** The export menu, in order. */
export const PLAN_EXPORT_ITEMS: readonly PlanExportItem[] = [
  { key: "copy-md", label: "Copy as Markdown", format: "markdown", action: "copy" },
  { key: "dl-md", label: "Download Markdown (.md)", format: "markdown", action: "download" },
  { key: "dl-html", label: "Download web page (.html)", format: "html", action: "download" },
  { key: "dl-json", label: "Download JSON (.json)", format: "json", action: "download" },
];

/** Largest plan text the importer sends (matches the server's limit). */
export const PLAN_IMPORT_MAX_CHARS = 200_000;

const REASON_LINES: Readonly<Record<PlanParseReasonWire, string>> = {
  "no-steps": "No steps found. Write one step per line, like “- [ ] Read the config”.",
  "invalid-json": "That is not valid JSON.",
  "invalid-shape": "That JSON is not a plan exported from here.",
  "unsupported-version": "That plan was written by a newer version of the format.",
};

/**
 * The sentence for a failed import: the reason in the reader's terms, with the framework's detail
 * after it when there is some that adds to it (a JSON syntax error says where). `reason` absent
 * (a network or server failure) shows the error as given.
 */
export function importFailureLine(failure: { readonly error: string; readonly reason?: PlanParseReasonWire }): string {
  if (failure.reason === undefined) return failure.error;
  const base = REASON_LINES[failure.reason];
  return failure.reason === "invalid-json" && failure.error !== "" && failure.error !== "Invalid JSON." ? `${base} ${failure.error}` : base;
}

/** True when pasted or uploaded text is empty after trimming (nothing to read). */
export const importTextBlank = (text: string): boolean => text.trim() === "";

/** True when the text is larger than the importer sends. */
export const importTextTooLarge = (text: string): boolean => text.length > PLAN_IMPORT_MAX_CHARS;
