/**
 * The calls Lab · Channels and the Gateway overview make (`/api/gateway`). Each returns a
 * tagged result and never throws; a credential value is sent once (PUT or a test) and the
 * server answers with masks only.
 */
import type { ChannelKind, ChannelSettings } from "./channels.js";

/** Result of a call: the parsed body, or a message safe to show. */
export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** A `fetch` (injectable for tests). */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** One credential field as the server reports it. */
export interface CredentialField {
  readonly field: string;
  readonly masked: string | null;
  readonly updatedAt: number | null;
}

/** Result of `POST /api/gateway/channels/test`. */
export interface ChannelProbe {
  readonly ok: boolean;
  readonly detail: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function call<T>(fetcher: Fetcher, url: string, init: RequestInit | undefined, parse: (v: unknown) => T | null): Promise<ApiResult<T>> {
  try {
    const res = await fetcher(url, init);
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, error: isRecord(body) && typeof body.error === "string" ? body.error : `Server answered ${res.status}.` };
    const value = parse(body);
    return value === null ? { ok: false, error: "The server sent an unexpected answer." } : { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the Cortex server." };
  }
}

const parseField = (v: unknown): CredentialField | null =>
  isRecord(v) && typeof v.field === "string"
    ? { field: v.field, masked: typeof v.masked === "string" ? v.masked : null, updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : null }
    : null;

const parseFields = (v: unknown): CredentialField[] | null =>
  isRecord(v) && Array.isArray(v.fields) ? v.fields.map(parseField).filter((f): f is CredentialField => f !== null) : null;

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Saved credential fields of a channel (masks only). */
export const fetchCredentials = (base: string, fetcher: Fetcher, channelId: string, kind: ChannelKind) =>
  call(fetcher, `${base}/api/gateway/channels/${encodeURIComponent(channelId)}/credentials?kind=${kind}`, undefined, parseFields);

/** Save or replace one credential. The value goes to the server once and is not kept. */
export const saveCredential = (base: string, fetcher: Fetcher, channelId: string, kind: ChannelKind, field: string, value: string) =>
  call(fetcher, `${base}/api/gateway/channels/${encodeURIComponent(channelId)}/credentials/${encodeURIComponent(field)}`, { method: "PUT", ...json({ kind, value }) }, parseField);

/** Remove one credential. */
export const deleteCredential = (base: string, fetcher: Fetcher, channelId: string, kind: ChannelKind, field: string) =>
  call(fetcher, `${base}/api/gateway/channels/${encodeURIComponent(channelId)}/credentials/${encodeURIComponent(field)}?kind=${kind}`, { method: "DELETE" }, parseFields);

/** Remove every credential of a channel that is being deleted. */
export const deleteChannelCredentials = (base: string, fetcher: Fetcher, channelId: string) =>
  call(fetcher, `${base}/api/gateway/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" }, (v) => (isRecord(v) ? true : null));

/** Probe a channel with a cheap read-only call. `credentials` is a value typed but not yet saved. */
export const testChannel = (
  base: string,
  fetcher: Fetcher,
  req: { channelId: string; kind: ChannelKind; settings: ChannelSettings; credentials?: Record<string, string> },
) =>
  call<ChannelProbe>(fetcher, `${base}/api/gateway/channels/test`, { method: "POST", ...json(req) }, (v) =>
    isRecord(v) && typeof v.ok === "boolean" && typeof v.detail === "string" ? { ok: v.ok, detail: v.detail } : null,
  );
