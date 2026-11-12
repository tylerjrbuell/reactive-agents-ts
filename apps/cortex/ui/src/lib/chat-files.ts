/**
 * Client for the composer's workspace file picker and the model's input capabilities
 * (`GET /api/chat/sessions/:id/files`, `/files/preview`, `/input-capabilities`).
 */
import type { InputCapabilitiesLike } from "@reactive-agents/ui-core";

/** One picker row. */
export interface WorkspaceFileHit {
  readonly path: string;
  readonly bytes: number;
  /** Offsets in `path` that matched the query, for highlighting. */
  readonly indices: readonly number[];
}

/** `GET …/files`. `workspace` is null when the chat has none. */
export interface WorkspaceFileSearch {
  readonly workspace: string | null;
  readonly files: readonly WorkspaceFileHit[];
  readonly truncated: boolean;
}

/** `GET …/files/preview`. */
export interface WorkspaceFilePreview {
  readonly path: string;
  readonly text: string;
  readonly totalBytes: number;
  readonly shownBytes: number;
  readonly truncated: boolean;
}

const EMPTY: WorkspaceFileSearch = { workspace: null, files: [], truncated: false };

/** Search the chat's workspace files; an empty result when the server cannot. */
export async function searchSessionFiles(baseUrl: string, sessionId: string, query: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<WorkspaceFileSearch> {
  try {
    const r = await fetchImpl(`${baseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}/files?q=${encodeURIComponent(query)}&limit=30`, signal ? { signal } : undefined);
    if (!r.ok) return EMPTY;
    return (await r.json()) as WorkspaceFileSearch;
  } catch {
    return EMPTY;
  }
}

/** Preview a tagged file, or the server's reason. */
export async function previewSessionFile(baseUrl: string, sessionId: string, path: string, fetchImpl: typeof fetch = fetch): Promise<{ readonly ok: true; readonly preview: WorkspaceFilePreview } | { readonly ok: false; readonly error: string }> {
  try {
    const r = await fetchImpl(`${baseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}/files/preview?path=${encodeURIComponent(path)}`);
    const j: unknown = await r.json();
    if (!r.ok) return { ok: false, error: typeof (j as { error?: unknown }).error === "string" ? (j as { error: string }).error : "Could not read the file" };
    return { ok: true, preview: j as WorkspaceFilePreview };
  } catch {
    return { ok: false, error: "Could not read the file" };
  }
}

/** The session model's input capabilities; undefined when unknown (everything stays allowed). */
export async function fetchInputCapabilities(baseUrl: string, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<InputCapabilitiesLike | undefined> {
  try {
    const r = await fetchImpl(`${baseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}/input-capabilities`);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { capabilities: { vision: boolean; audioIn: boolean | null; authoritative: boolean } | null };
    const c = j.capabilities;
    return c ? { vision: c.vision, ...(c.audioIn !== null ? { audioIn: c.audioIn } : {}), authoritative: c.authoritative } : undefined;
  } catch {
    return undefined;
  }
}
