/**
 * Webhook channel helpers: how a caller connects, a generated signing secret, and a signed test
 * request. Cortex renders the framework's connection facts (`webhookConnectionInfo`,
 * `signRequest` from `@reactive-agents/channels`); it never re-implements the signing scheme.
 *
 * The ingress Cortex mounts for a webhook channel (`channel-ingress.ts`) listens on loopback only,
 * so the base URL is `http://127.0.0.1:<ingressPort>`. A custom `route` setting replaces the
 * framework's default `/channels/<id>` path in every field and example.
 *
 * The signing secret is read from the sealed store by the caller and used here only to sign; no
 * result carries it (the test detail is scrubbed too). Nothing here throws.
 */
import { signRequest, webhookConnectionInfo, type WebhookConnectionInfo } from "@reactive-agents/channels";

/** The host the webhook ingress binds. */
export const WEBHOOK_INGRESS_HOST = "127.0.0.1";

/** The webhook settings these helpers read. */
export interface WebhookSettingsView {
  readonly ingressPort?: number;
  readonly route?: string;
}

/** A route path the test request may post to: a slash and URL-safe characters only. */
export const WEBHOOK_ROUTE_PATTERN = /^\/[A-Za-z0-9._~/-]*$/;

/** The framework's connection info plus what Cortex adds about where the listener is reachable. */
export interface WebhookInfoView {
  readonly info: WebhookConnectionInfo;
  /** The listener is bound to 127.0.0.1: only this machine reaches it without a tunnel or proxy. */
  readonly loopbackOnly: true;
  readonly host: string;
  readonly port: number | null;
  /** True when the `route` setting replaced the framework's default path. */
  readonly customRoute: boolean;
}

/**
 * Connection info for a webhook channel. With no `ingressPort` the info carries the path only.
 * A custom route replaces the default path wherever the framework wrote it.
 */
export function webhookInfoFor(channelId: string, settings: WebhookSettingsView): WebhookInfoView {
  const port = settings.ingressPort ?? null;
  const base = webhookConnectionInfo({
    channelId,
    ...(port !== null ? { baseUrl: `http://${WEBHOOK_INGRESS_HOST}:${port}` } : {}),
  });
  const route = settings.route && WEBHOOK_ROUTE_PATTERN.test(settings.route) ? settings.route : undefined;
  const swap = (s: string): string => (route ? s.split(base.path).join(route) : s);
  const info: WebhookConnectionInfo = route
    ? {
        ...base,
        path: route,
        ...(base.url ? { url: swap(base.url) } : {}),
        examples: { curl: swap(base.examples.curl), node: swap(base.examples.node), openssl: swap(base.examples.openssl) },
      }
    : base;
  return { info, loopbackOnly: true, host: WEBHOOK_INGRESS_HOST, port, customRoute: route !== undefined };
}

/** A new random signing secret (`whsec_` + 64 hex characters). */
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `whsec_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Result of a test request. `detail` never contains the secret or the signature. */
export interface WebhookTestResult {
  readonly ok: boolean;
  /** HTTP status the listener answered, when it answered. */
  readonly status: number | null;
  /** One line for the user: accepted, or why it was refused. */
  readonly detail: string;
}

/** A `fetch` the test posts with (injectable; no network in unit tests). */
export type WebhookFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: "manual"; signal: AbortSignal }) => Promise<{ readonly status: number; readonly text: () => Promise<string> }>;

const defaultFetch: WebhookFetch = (url, init) => fetch(url, init);

const scrub = (text: string, ...secrets: readonly string[]): string => secrets.reduce((t, s) => (s.length >= 4 ? t.split(s).join("••••") : t), text);

const errorParts = (e: unknown): { name: string; message: string } =>
  typeof e === "object" && e !== null ? { name: String(Reflect.get(e, "name") ?? ""), message: String(Reflect.get(e, "message") ?? e) } : { name: "", message: String(e) };

const reasonOf =(raw: string): string => {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null) {
      const o: Record<string, unknown> = Object.fromEntries(Object.entries(v));
      for (const k of ["error", "message", "reason"]) if (typeof o[k] === "string" && o[k]) return o[k];
    }
  } catch {
    // not JSON: fall through to a short text tail
  }
  return raw.trim().slice(0, 160);
};

/**
 * Post a body signed with the framework's `signRequest` to the local ingress and report whether it
 * was accepted. The request goes from the Cortex server, so the browser never sees the secret.
 */
export async function sendWebhookTest(
  input: { readonly port: number; readonly route: string; readonly secret: string; readonly nowMs?: number },
  doFetch: WebhookFetch = defaultFetch,
): Promise<WebhookTestResult> {
  const body = JSON.stringify({ id: `cortex-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, content: "Test request from Cortex" });
  const signed = signRequest(input.secret, body, input.nowMs !== undefined ? { nowMs: input.nowMs } : {});
  const url = `http://${WEBHOOK_INGRESS_HOST}:${input.port}${input.route}`;
  try {
    const res = await doFetch(url, { method: "POST", headers: { ...signed.headers }, body, redirect: "manual", signal: AbortSignal.timeout(8_000) });
    const text = await res.text().catch(() => "");
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, detail: `Accepted (${res.status}).` };
    const why = scrub(reasonOf(text), input.secret, signed.signature);
    const lead = res.status === 401 || res.status === 403 ? "The signature did not verify" : res.status === 404 ? "No webhook is mounted at that path" : `The listener answered ${res.status}`;
    return { ok: false, status: res.status, detail: `${lead} (${res.status})${why ? `: ${why}` : ""}.` };
  } catch (e) {
    const err = errorParts(e);
    const msg = scrub(err.message, input.secret, signed.signature);
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    return {
      ok: false,
      status: null,
      detail: timedOut
        ? `No answer from ${url} within 8 seconds.`
        : `Nothing answered at ${WEBHOOK_INGRESS_HOST}:${input.port}. Enable the channel and make sure the channel hub or its agent is running. (${msg})`,
    };
  }
}
