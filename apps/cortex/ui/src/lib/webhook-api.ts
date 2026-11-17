/**
 * The calls the webhook connection panel makes (`/api/channels/:id/webhook-*`). Result values,
 * never throws. The generated secret arrives once, in `generateWebhookSecret`'s answer, and is
 * held by the caller only until the person copies it.
 */
import { call, isRecord, json, type ApiResult, type Fetcher } from "./gateway-api.js";

/** The framework's connection info, as the server forwards it. */
export interface WebhookInfo {
  readonly method: string;
  readonly path: string;
  readonly url: string | null;
  readonly contentType: string;
  readonly signature: {
    readonly header: string;
    readonly algorithm: string;
    readonly encoding: string;
    readonly signedPayload: string;
    readonly timestampHeader: string;
    readonly timestamp: string;
    readonly replayWindowMs: number;
    readonly replay: string;
  };
  readonly examples: { readonly curl: string; readonly node: string; readonly openssl: string };
}

/** Info plus where the listener is reachable. */
export interface WebhookInfoView {
  readonly info: WebhookInfo;
  readonly loopbackOnly: boolean;
  readonly host: string;
  readonly port: number | null;
  readonly customRoute: boolean;
}

/** A generated signing secret, shown once. */
export interface GeneratedSecret {
  readonly secret: string;
  readonly masked: string;
  readonly updatedAt: number;
}

/** Result of a test request. */
export interface WebhookTestOutcome {
  readonly ok: boolean;
  readonly status: number | null;
  readonly detail: string;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parseInfo(v: unknown): WebhookInfoView | null {
  if (!isRecord(v) || !isRecord(v.info)) return null;
  const i = v.info;
  const s = i.signature;
  const e = i.examples;
  if (!isRecord(s) || !isRecord(e)) return null;
  const required = [i.method, i.path, i.contentType, s.header, s.algorithm, s.encoding, s.signedPayload, s.timestampHeader, s.timestamp, s.replay, e.curl, e.node, e.openssl];
  if (!required.every((f) => typeof f === "string") || typeof s.replayWindowMs !== "number") return null;
  const t = (x: unknown): string => str(x) ?? "";
  return {
    info: {
      method: t(i.method),
      path: t(i.path),
      url: str(i.url),
      contentType: t(i.contentType),
      signature: {
        header: t(s.header),
        algorithm: t(s.algorithm),
        encoding: t(s.encoding),
        signedPayload: t(s.signedPayload),
        timestampHeader: t(s.timestampHeader),
        timestamp: t(s.timestamp),
        replayWindowMs: s.replayWindowMs,
        replay: t(s.replay),
      },
      examples: { curl: t(e.curl), node: t(e.node), openssl: t(e.openssl) },
    },
    loopbackOnly: v.loopbackOnly !== false,
    host: str(v.host) ?? "127.0.0.1",
    port: typeof v.port === "number" ? v.port : null,
    customRoute: v.customRoute === true,
  };
}

const q = (settings: { ingressPort?: number | undefined; route?: string | undefined }): string => {
  const p = new URLSearchParams();
  if (settings.ingressPort !== undefined) p.set("ingressPort", String(settings.ingressPort));
  if (settings.route) p.set("route", settings.route);
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** How a caller connects to this webhook. `settings` fill in for a channel the server has no row for. */
export const fetchWebhookInfo = (base: string, fetcher: Fetcher, channelId: string, settings: { ingressPort?: number | undefined; route?: string | undefined } = {}): Promise<ApiResult<WebhookInfoView>> =>
  call(fetcher, `${base}/api/channels/${encodeURIComponent(channelId)}/webhook-info${q(settings)}`, undefined, parseInfo);

/** Generate and store a signing secret. The value is in this answer only. */
export const generateWebhookSecret = (base: string, fetcher: Fetcher, channelId: string): Promise<ApiResult<GeneratedSecret>> =>
  call(fetcher, `${base}/api/channels/${encodeURIComponent(channelId)}/webhook-secret`, { method: "POST" }, (v) =>
    isRecord(v) && typeof v.secret === "string" && typeof v.masked === "string" && typeof v.updatedAt === "number" ? { secret: v.secret, masked: v.masked, updatedAt: v.updatedAt } : null,
  );

/** Post a signed test request from the server to the local listener. */
export const sendWebhookTestRequest = (base: string, fetcher: Fetcher, channelId: string, settings: { ingressPort?: number | undefined; route?: string | undefined } = {}): Promise<ApiResult<WebhookTestOutcome>> =>
  call(fetcher, `${base}/api/channels/${encodeURIComponent(channelId)}/webhook-test`, { method: "POST", ...json(settings) }, (v) =>
    isRecord(v) && typeof v.ok === "boolean" && typeof v.detail === "string" ? { ok: v.ok, status: typeof v.status === "number" ? v.status : null, detail: v.detail } : null,
  );
