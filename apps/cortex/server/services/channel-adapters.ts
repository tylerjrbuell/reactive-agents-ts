/**
 * Live channel adapters from stored channel entries + saved credentials.
 *
 * The one place Cortex constructs `@reactive-agents/channels` adapters, so the gateway host
 * (which starts them) and the "Test connection" probe build them the same way. A channel whose
 * credential is missing is reported in `skipped` with a plain reason instead of being built
 * half-configured: an adapter with an empty token would fail later with a worse message.
 * Credentials are wrapped in `Redacted` before they reach the adapter and never leave this module.
 */
import { Redacted } from "effect";
import {
  SignalChannelAdapter,
  TelegramChannelAdapter,
  WebhookChannelAdapter,
  makeSignalProcessTransport,
  makeSignalSocketTransport,
  type ChannelAdapter,
} from "@reactive-agents/channels";
import { checkOutboundUrl } from "../outbound-url.js";
import { ChannelReplyError } from "../errors.js";
import { enabledChannels, type CortexChannelEntry } from "./channel-config.js";
import type { ChannelCredentials } from "./channel-credentials.js";

/** The read half of {@link ChannelCredentials}: all an adapter build or probe needs. */
export type CredentialReader = Pick<ChannelCredentials, "value">;

/** A webhook channel and the adapter that must be mounted on an ingress server. */
export interface WebhookMount {
  readonly entry: CortexChannelEntry;
  readonly adapter: WebhookChannelAdapter;
  /** URL path the sender posts to. */
  readonly route: string;
  readonly port: number;
}

/** What building a set of channels produced. */
export interface BuiltChannels {
  /** Adapters to register with `.withChannels` (the framework starts them on `agent.start()`). */
  readonly adapters: readonly ChannelAdapter[];
  /** Webhook adapters that also need an ingress server (the framework does not mount them). */
  readonly webhooks: readonly WebhookMount[];
  /** Enabled channels that could not be built, with the reason shown to the user. */
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
}

/** Webhook replies: POST JSON to the configured URL, after the same outbound-URL check as other fetches. */
const replyToUrl = (url: string, signal?: AbortSignal) => async (
  target: { readonly channelId: string; readonly threadId?: string },
  content: { readonly text: string },
): Promise<void> => {
  const checked = await checkOutboundUrl(url);
  if (!checked.ok) throw new ChannelReplyError({ message: `reply URL refused: ${checked.reason}` });
  const res = await fetch(checked.url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId: target.channelId, ...(target.threadId ? { threadId: target.threadId } : {}), text: content.text }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new ChannelReplyError({ message: `reply endpoint answered ${res.status}`, status: res.status });
};

/**
 * One adapter for `entry`, or the reason it cannot be built. Pure apart from reading the
 * credential; nothing is started or connected.
 */
export function buildChannelAdapter(
  entry: CortexChannelEntry,
  creds: CredentialReader,
): { readonly ok: true; readonly adapter: ChannelAdapter; readonly webhook?: WebhookMount } | { readonly ok: false; readonly reason: string } {
  const s = entry.settings;
  switch (entry.kind) {
    case "telegram": {
      const token = creds.value(entry.id, "token");
      if (!token) return { ok: false, reason: "No bot token saved." };
      return { ok: true, adapter: new TelegramChannelAdapter({ id: entry.id, token: Redacted.make(token) }) };
    }
    case "signal": {
      const account = creds.value(entry.id, "account");
      if (!account) return { ok: false, reason: "No Signal account number saved." };
      const transport =
        s.transport === "process"
          ? makeSignalProcessTransport({ adapterId: entry.id, account })
          : makeSignalSocketTransport({
              adapterId: entry.id,
              ...(s.path ? { path: s.path } : { ...(s.host ? { host: s.host } : {}), ...(s.port !== undefined ? { port: s.port } : {}) }),
            });
      return { ok: true, adapter: new SignalChannelAdapter({ id: entry.id, account: Redacted.make(account), transport }) };
    }
    case "webhook": {
      const secret = creds.value(entry.id, "secret");
      if (!secret) return { ok: false, reason: "No signing secret saved. An unsigned webhook is refused." };
      if (s.ingressPort === undefined) return { ok: false, reason: "No port set for the webhook listener." };
      const adapter = new WebhookChannelAdapter({
        id: entry.id,
        secret: Redacted.make(secret),
        ...(s.replyUrl ? { onResponse: replyToUrl(s.replyUrl) } : {}),
      });
      return { ok: true, adapter, webhook: { entry, adapter, route: s.route ?? `/channels/${entry.id}`, port: s.ingressPort } };
    }
  }
}

/** Adapters for every enabled entry; unbuildable ones are listed in `skipped`. */
export function buildChannelAdapters(entries: readonly CortexChannelEntry[], creds: CredentialReader): BuiltChannels {
  const adapters: ChannelAdapter[] = [];
  const webhooks: WebhookMount[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const entry of enabledChannels(entries)) {
    const r = buildChannelAdapter(entry, creds);
    if (!r.ok) {
      skipped.push({ id: entry.id, reason: r.reason });
      continue;
    }
    adapters.push(r.adapter);
    if (r.webhook) webhooks.push(r.webhook);
  }
  return { adapters, webhooks, skipped };
}

// ─── Test connection ───

/** Result of a connection probe. `detail` never contains a credential. */
export interface ChannelProbeResult {
  readonly ok: boolean;
  /** One line for the user: who answered, or why it did not. */
  readonly detail: string;
}

/** Telegram `getMe` fetch; injectable for tests (no network). */
export type TelegramFetch = (url: string) => Promise<{ readonly status: number; readonly json: () => Promise<unknown> }>;

const defaultTelegramFetch: TelegramFetch = (url) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8_000) });

/** Probe a TCP/unix signal-cli daemon port: injectable for tests. */
export type SocketProbe = (target: { readonly host?: string; readonly port?: number; readonly path?: string }) => Promise<boolean>;

const defaultSocketProbe: SocketProbe = async (target) => {
  const { createConnection } = await import("node:net");
  return new Promise<boolean>((resolve) => {
    const sock = target.path ? createConnection({ path: target.path }) : createConnection({ host: target.host ?? "127.0.0.1", port: target.port ?? 7583 });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(4_000, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
};

/** Replace every occurrence of `secret` in `text` so an upstream error cannot echo it. */
const scrub = (text: string, secret: string): string => (secret.length >= 4 ? text.split(secret).join("••••") : text);

/**
 * A cheap, read-only auth probe per adapter, with no message sent:
 * - Telegram: `getMe` on the Bot API (the token is in the URL path, so an error is scrubbed).
 * - Signal: can Cortex reach the `signal-cli` daemon (a socket connect; the account is not sent).
 * - Webhook: nothing to dial; checks the secret, port and reply URL are usable.
 */
export async function probeChannel(
  entry: CortexChannelEntry,
  creds: CredentialReader,
  deps: { readonly fetchTelegram?: TelegramFetch; readonly probeSocket?: SocketProbe } = {},
): Promise<ChannelProbeResult> {
  const s = entry.settings;
  switch (entry.kind) {
    case "telegram": {
      const token = creds.value(entry.id, "token");
      if (!token) return { ok: false, detail: "No bot token saved." };
      try {
        const res = await (deps.fetchTelegram ?? defaultTelegramFetch)(`https://api.telegram.org/bot${token}/getMe`);
        const body = (await res.json().catch(() => undefined)) as { ok?: boolean; result?: { username?: string }; description?: string } | undefined;
        if (res.status === 200 && body?.ok === true) return { ok: true, detail: `Connected as @${body.result?.username ?? "bot"}.` };
        if (res.status === 401) return { ok: false, detail: "Telegram rejected the token (401). Check it with @BotFather." };
        return { ok: false, detail: scrub(`Telegram answered ${res.status}${body?.description ? `: ${body.description}` : ""}.`, token) };
      } catch (e) {
        return { ok: false, detail: scrub(`Could not reach Telegram: ${e instanceof Error ? e.message : String(e)}`, token) };
      }
    }
    case "signal": {
      if (!creds.value(entry.id, "account")) return { ok: false, detail: "No Signal account number saved." };
      if (s.transport === "process") {
        return { ok: true, detail: "signal-cli is started by Cortex when the agent starts. The probe cannot check it without spawning it." };
      }
      const reachable = await (deps.probeSocket ?? defaultSocketProbe)(s.path ? { path: s.path } : { ...(s.host ? { host: s.host } : {}), ...(s.port !== undefined ? { port: s.port } : {}) });
      return reachable
        ? { ok: true, detail: "The signal-cli daemon accepts connections." }
        : { ok: false, detail: "Nothing is listening for signal-cli at that address. Start `signal-cli daemon --tcp` first." };
    }
    case "webhook": {
      if (!creds.value(entry.id, "secret")) return { ok: false, detail: "No signing secret saved. An unsigned webhook is refused." };
      if (s.ingressPort === undefined) return { ok: false, detail: "No port set for the webhook listener." };
      if (s.replyUrl) {
        const checked = await checkOutboundUrl(s.replyUrl);
        if (!checked.ok) return { ok: false, detail: `Reply URL refused: ${checked.reason}.` };
      }
      return { ok: true, detail: `Ready: listens on 127.0.0.1:${s.ingressPort}${s.route ?? `/channels/${entry.id}`}.` };
    }
  }
}
