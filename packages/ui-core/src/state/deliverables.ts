/**
 * Deliverables: what a run produced, derived from its own tool calls, its
 * receipt and its typed result, never scraped from the answer prose.
 *
 * A chat turn and a run view fold the same inputs, so one derivation serves
 * every UI. Pure and framework-agnostic.
 */

/** What a deliverable is, for its icon and its actions. */
export type DeliverableKind = "file" | "report" | "image" | "diff" | "data" | "structured" | "declared";

/** One thing a run produced. */
export interface DeliverableItem {
  /** Stable key (path, or `structured`). */
  readonly id: string;
  readonly kind: DeliverableKind;
  /** Display name: the file's base name, or a label. */
  readonly name: string;
  /** Path as the tool reported it (absolute when the tool resolved it). */
  readonly path?: string;
  /** MIME type guessed from the extension. */
  readonly mediaType?: string;
  /** Text content known from the call itself (a write's `content`, an edit's patch, the typed object), capped. */
  readonly content?: string;
  /** Characters of the full content when `content` was capped. */
  readonly contentChars?: number;
  /** True when `content` is shorter than the full text. */
  readonly truncated?: boolean;
  /** The producing tool (`file-write`, `file-edit`) or `receipt` / `result`. */
  readonly source: string;
  /** A declared deliverable the run did not produce. */
  readonly missing?: boolean;
}

/** The tool-call fields the derivation reads (a subset of `TraceToolCall`). */
export interface DeliverableCallLike {
  readonly name: string;
  readonly status: "running" | "done" | "failed";
  readonly args?: unknown;
  readonly result?: string;
}

/** A receipt deliverable (`{ spec, produced }`). */
export interface DeclaredDeliverableLike {
  readonly spec: string;
  readonly produced: boolean;
}

/** Inputs of {@link deliverablesOf}. */
export interface DeliverableInputs {
  readonly toolCalls?: readonly DeliverableCallLike[];
  readonly declared?: readonly DeclaredDeliverableLike[];
  /** The typed result object (`.withOutputSchema`), when the run had one. */
  readonly structured?: unknown;
}

/** Inline content kept per deliverable; the file itself stays on disk. */
export const DELIVERABLE_CONTENT_CAP = 40_000;

const WRITE_TOOLS: ReadonlySet<string> = new Set(["file-write", "file-edit"]);

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", json: "application/json",
  csv: "text/csv", html: "text/html", css: "text/css", js: "text/javascript", ts: "text/typescript",
  py: "text/x-python", yaml: "text/yaml", yml: "text/yaml", xml: "application/xml", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  patch: "text/x-diff", diff: "text/x-diff",
};

const extOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};

/** The base name of a path (either separator). */
export const baseNameOf = (path: string): string => path.replace(/[\\]/g, "/").replace(/\/+$/, "").split("/").pop() ?? path;

/** MIME type from a file name's extension; `application/octet-stream` when unknown. */
export const mediaTypeOfPath = (path: string): string => MEDIA_TYPES[extOf(path.replace(/[\\]/g, "/"))] ?? "application/octet-stream";

const kindOfPath = (path: string, tool: string): DeliverableKind => {
  const ext = extOf(path);
  if (tool === "file-edit") return "diff";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["md", "markdown", "txt", "html"].includes(ext)) return "report";
  if (["json", "csv", "yaml", "yml", "xml"].includes(ext)) return "data";
  return "file";
};

const record = (v: unknown): Readonly<Record<string, unknown>> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Readonly<Record<string, unknown>>) : undefined;

const resolvedPathOf = (result: string | undefined): string | undefined => {
  if (result === undefined) return undefined;
  try {
    const p = record(JSON.parse(result))?.["path"];
    return typeof p === "string" && p.length > 0 ? p : undefined;
  } catch {
    return undefined;
  }
};

const capped = (text: string): { content: string; contentChars: number; truncated: boolean } =>
  text.length > DELIVERABLE_CONTENT_CAP
    ? { content: text.slice(0, DELIVERABLE_CONTENT_CAP), contentChars: text.length, truncated: true }
    : { content: text, contentChars: text.length, truncated: false };

/** A unified-style patch for one edit call, from its `oldText` / `newText`. */
const patchOf = (args: Readonly<Record<string, unknown>>): string | undefined => {
  const oldText = args["oldText"];
  const newText = args["newText"];
  if (typeof oldText !== "string" || typeof newText !== "string") return undefined;
  const side = (prefix: string, text: string) => text.split("\n").map((l) => `${prefix}${l}`).join("\n");
  return `${side("-", oldText)}\n${side("+", newText)}`;
};

/**
 * The deliverables of a run, in the order they were first produced: files its
 * file-write / file-edit calls completed (one entry per path, later writes
 * replace the content, edits stack as a patch when the file was not written
 * whole), the typed result, and any receipt-declared deliverable not already a
 * file above. A failed or still-running call produces nothing.
 */
export function deliverablesOf(input: DeliverableInputs): readonly DeliverableItem[] {
  const byId = new Map<string, DeliverableItem>();
  const order: string[] = [];
  for (const call of input.toolCalls ?? []) {
    if (!WRITE_TOOLS.has(call.name) || call.status !== "done") continue;
    const args = record(call.args);
    const argPath = typeof args?.["path"] === "string" ? (args["path"] as string) : undefined;
    const path = resolvedPathOf(call.result) ?? argPath;
    if (path === undefined || args === undefined) continue;
    const prev = byId.get(path);
    const whole = call.name === "file-write" && typeof args["content"] === "string" ? (args["content"] as string) : undefined;
    const patch = call.name === "file-edit" ? patchOf(args) : undefined;
    const base = {
      id: path,
      name: baseNameOf(path),
      path,
      mediaType: mediaTypeOfPath(path),
      source: call.name,
    };
    let next: DeliverableItem;
    if (whole !== undefined) {
      next = { ...base, kind: kindOfPath(path, "file-write"), ...capped(whole) };
    } else if (prev !== undefined && prev.source === "file-write") {
      // An edit after a whole write: keep the file entry, its content is the write's (a stale view is marked by the source).
      next = prev;
    } else if (patch !== undefined) {
      const joined = prev?.content !== undefined && prev.kind === "diff" ? `${prev.content}\n${patch}` : patch;
      next = { ...base, kind: "diff", ...capped(joined) };
    } else {
      next = { ...base, kind: kindOfPath(path, call.name) };
    }
    if (!byId.has(path)) order.push(path);
    byId.set(path, next);
  }
  const items: DeliverableItem[] = order.map((id) => byId.get(id)!);
  const s = input.structured;
  if (s !== undefined && s !== null) {
    const text = typeof s === "string" ? s : JSON.stringify(s, null, 2);
    items.push({ id: "structured", kind: "structured", name: "Structured result", mediaType: "application/json", source: "result", ...capped(text) });
  }
  const have = new Set(items.flatMap((i) => (i.path === undefined ? [] : [i.path, baseNameOf(i.path)])));
  for (const d of input.declared ?? []) {
    const spec = d.spec.trim();
    if (spec === "" || have.has(spec) || have.has(baseNameOf(spec))) continue;
    items.push({ id: `declared:${spec}`, kind: "declared", name: baseNameOf(spec), path: spec, source: "receipt", ...(d.produced ? {} : { missing: true }) });
  }
  return items;
}

/** Text of a deliverable for Copy and Download (its known content, else empty). */
export const deliverableText = (d: DeliverableItem): string => d.content ?? "";

/** File name for downloading a deliverable. */
export const deliverableFileName = (d: DeliverableItem): string => {
  if (d.kind === "structured") return "result.json";
  if (d.kind === "diff") return `${d.name}.patch`;
  return d.name;
};

/** An event as the framework publishes it (`_tag` plus its fields); only tool-call events are read. */
export interface ToolCallEventLike {
  readonly _tag: string;
  readonly callId?: string;
  readonly toolName?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly success?: boolean;
}

/**
 * Tool calls folded from `ToolCallStarted` / `ToolCallCompleted` events (a run view's
 * event list), paired by `callId`, in start order. A call with no completion is still
 * `running`; one that completed with `success: false` is `failed`. Arguments come from
 * whichever event carried them.
 */
export function deliverableCallsOf(events: readonly ToolCallEventLike[]): readonly DeliverableCallLike[] {
  const calls = new Map<string, { name: string; status: DeliverableCallLike["status"]; args?: unknown; result?: string }>();
  for (const e of events) {
    if ((e._tag !== "ToolCallStarted" && e._tag !== "ToolCallCompleted") || typeof e.callId !== "string" || typeof e.toolName !== "string") continue;
    const prev = calls.get(e.callId) ?? { name: e.toolName, status: "running" as const };
    const next = { ...prev };
    if (e.args !== undefined) next.args = e.args;
    if (e._tag === "ToolCallCompleted") {
      next.status = e.success === false ? "failed" : "done";
      if (e.result !== undefined) next.result = typeof e.result === "string" ? e.result : JSON.stringify(e.result);
    }
    calls.set(e.callId, next);
  }
  return [...calls.values()];
}
