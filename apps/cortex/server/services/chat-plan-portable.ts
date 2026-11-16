/**
 * A chat session's plan as a portable document: Markdown, JSON or HTML out, Markdown or JSON in.
 * Every format is the framework's (`planToMarkdown` / `planFromMarkdown` / `planToJSON` /
 * `planFromJSON` / `planToHtml`, `@reactive-agents/core`); Cortex only picks the format, names the
 * file and words the failure. Pure.
 */
import { Either } from "effect";
import {
  planFromJSON,
  planFromMarkdown,
  planToHtml,
  planToJSON,
  planToMarkdown,
  type Plan,
  type PlanParseReason,
} from "@reactive-agents/core";

/** A format the plan can be written in. */
export type PlanExportFormat = "markdown" | "html" | "json";

/** The formats, in the order a menu lists them. */
export const PLAN_EXPORT_FORMATS: readonly PlanExportFormat[] = ["markdown", "html", "json"];

/** True for a format name the export route accepts. */
export const isPlanExportFormat = (s: string): s is PlanExportFormat => (PLAN_EXPORT_FORMATS as readonly string[]).includes(s);

const FILES: Readonly<Record<PlanExportFormat, { readonly ext: string; readonly mime: string }>> = {
  markdown: { ext: "md", mime: "text/markdown; charset=utf-8" },
  html: { ext: "html", mime: "text/html; charset=utf-8" },
  json: { ext: "json", mime: "application/json; charset=utf-8" },
};

/** A plan rendered for download or copy. */
export interface PlanExport {
  readonly body: string;
  readonly mime: string;
  readonly filename: string;
}

/** Render `plan` in `format`. The file name is `plan-<session id>.<ext>`, safe for a download header. */
export function exportPlan(plan: Plan, format: PlanExportFormat, sessionId: string): PlanExport {
  const body = format === "markdown" ? planToMarkdown(plan) : format === "html" ? planToHtml(plan) : planToJSON(plan);
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
  return { body, mime: FILES[format].mime, filename: `plan-${safe}.${FILES[format].ext}` };
}

/** Why an import could not be read: the framework's reason and a sentence for the person. */
export interface PlanImportFailure {
  readonly ok: false;
  readonly reason: PlanParseReason;
  readonly message: string;
}

/** The result of reading a pasted or uploaded plan. */
export type PlanImportResult = { readonly ok: true; readonly plan: Plan } | PlanImportFailure;

/** Largest import (characters) the route reads; a plan is a few KB. */
export const PLAN_IMPORT_MAX_CHARS = 200_000;

/** JSON when the text starts like an object, else Markdown (the framework reads hand-written lists too). */
export const looksLikeJson = (text: string): boolean => text.trimStart().startsWith("{");

/**
 * Read `text` as a plan. A plan someone brought in is a user edit: the source is `user-edited`
 * whatever the document says, so the model's authorship is never claimed for it.
 */
export function importPlan(text: string): PlanImportResult {
  const parsed = looksLikeJson(text) ? planFromJSON(text) : planFromMarkdown(text);
  if (Either.isLeft(parsed)) return { ok: false, reason: parsed.left.reason, message: parsed.left.message };
  return { ok: true, plan: { ...parsed.right, source: "user-edited" } };
}
