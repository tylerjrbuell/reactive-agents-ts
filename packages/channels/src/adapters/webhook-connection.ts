import { createHmac } from "node:crypto";
import { Redacted } from "effect";

/** Request header carrying the hex HMAC-SHA256 signature. Single source for verification and docs. */
export const WEBHOOK_SIGNATURE_HEADER = "x-channels-signature";
/** Request header carrying the signing timestamp (epoch seconds or milliseconds). */
export const WEBHOOK_TIMESTAMP_HEADER = "x-channels-timestamp";
/** HMAC algorithm used to sign requests. */
export const WEBHOOK_SIGNATURE_ALGORITHM = "sha256";
/** Signature output encoding. */
export const WEBHOOK_SIGNATURE_ENCODING = "hex";
/** Default replay window: a timestamp further than this from the receiver clock is refused. */
export const WEBHOOK_DEFAULT_REPLAY_WINDOW_MS = 300_000;
/** Content type the webhook channel expects. */
export const WEBHOOK_CONTENT_TYPE = "application/json";
/** Exactly what is signed: the timestamp header value, a dot, then the raw request body. */
export const WEBHOOK_SIGNED_PAYLOAD = "<timestamp>.<raw request body>";

/** Mount path the framework ingress serves for a webhook channel adapter id. */
export const webhookIngressPath = (channelId: string): string => `/channels/${channelId}`;

const secretValue = (secret: string | Redacted.Redacted<string>): string =>
  typeof secret === "string" ? secret : Redacted.value(secret);

/**
 * Computes the signature the adapter verifies: hex(HMAC-SHA256(secret, `${timestamp}.${body}`)).
 * `timestamp` must be the exact string sent in the timestamp header.
 */
export function signWebhookPayload(
  secret: string | Redacted.Redacted<string>,
  timestamp: string,
  body: string,
): string {
  return createHmac(WEBHOOK_SIGNATURE_ALGORITHM, secretValue(secret))
    .update(`${timestamp}.${body}`)
    .digest(WEBHOOK_SIGNATURE_ENCODING);
}

/** Options for {@link signRequest}. */
export interface SignRequestOptions {
  /** Epoch milliseconds used to derive the timestamp header. Default `Date.now()`. */
  readonly nowMs?: number;
}

/** Headers a sender must send, plus the parts they were derived from. */
export interface SignedWebhookRequest {
  /** Header map to send with the POST body (lowercase names). */
  readonly headers: Readonly<Record<string, string>>;
  /** Timestamp header value (epoch seconds). */
  readonly timestamp: string;
  /** Hex signature header value. */
  readonly signature: string;
}

/**
 * Produces the headers a sender must attach to a webhook POST: content type, epoch-seconds
 * timestamp and the HMAC signature over `"<timestamp>.<body>"`. Send `body` byte-for-byte as signed.
 */
export function signRequest(
  secret: string | Redacted.Redacted<string>,
  body: string,
  opts: SignRequestOptions = {},
): SignedWebhookRequest {
  const timestamp = String(Math.floor((opts.nowMs ?? Date.now()) / 1000));
  const signature = signWebhookPayload(secret, timestamp, body);
  return {
    headers: {
      "content-type": WEBHOOK_CONTENT_TYPE,
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [WEBHOOK_SIGNATURE_HEADER]: signature,
    },
    timestamp,
    signature,
  };
}

/** Input to {@link webhookConnectionInfo}. */
export interface WebhookConnectionInfoInput {
  /** Public base URL of the agent, e.g. `https://agent.example.com`. Omit to get `path` only. */
  readonly baseUrl?: string;
  /** Adapter id (the `<id>` in `/channels/<id>`). Default `webhook`. */
  readonly channelId?: string;
  /** Replay window the adapter is configured with. Default {@link WEBHOOK_DEFAULT_REPLAY_WINDOW_MS}. */
  readonly replayWindowMs?: number;
}

/** Everything a caller needs to post a signed request to a webhook channel. */
export interface WebhookConnectionInfo {
  readonly method: "POST";
  /** Path the framework ingress serves, `/channels/<id>`. */
  readonly path: string;
  /** `baseUrl` + `path`, present only when a base URL was given. */
  readonly url?: string;
  readonly contentType: string;
  readonly signature: {
    readonly header: string;
    readonly algorithm: "HMAC-SHA256";
    readonly encoding: "hex";
    /** Exactly which bytes are signed. */
    readonly signedPayload: string;
    readonly timestampHeader: string;
    /** Timestamp rule: epoch seconds or milliseconds, bound into the signature. */
    readonly timestamp: string;
    readonly replayWindowMs: number;
    /** Replay rule in words. */
    readonly replay: string;
  };
  readonly examples: {
    readonly curl: string;
    readonly node: string;
    readonly openssl: string;
  };
}

const EXAMPLE_BODY = '{"id":"evt-1","content":"hello"}';

/**
 * Describes how to call a webhook channel, generated from the same constants the adapter verifies
 * with. Examples use the placeholder secret `$WEBHOOK_SECRET`; never embed a real secret.
 */
export function webhookConnectionInfo(input: WebhookConnectionInfoInput = {}): WebhookConnectionInfo {
  const path = webhookIngressPath(input.channelId ?? "webhook");
  const url = input.baseUrl !== undefined ? `${input.baseUrl.replace(/\/+$/, "")}${path}` : undefined;
  const target = url ?? path;
  const replayWindowMs = input.replayWindowMs ?? WEBHOOK_DEFAULT_REPLAY_WINDOW_MS;
  const algo = WEBHOOK_SIGNATURE_ALGORITHM;
  const enc = WEBHOOK_SIGNATURE_ENCODING;
  const curl = [
    `BODY='${EXAMPLE_BODY}'`,
    `TS=$(date +%s)`,
    `SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -${algo} -hmac "$WEBHOOK_SECRET" -${enc} | sed 's/^.* //')`,
    `curl -X POST '${target}' \\`,
    `  -H 'content-type: ${WEBHOOK_CONTENT_TYPE}' \\`,
    `  -H "${WEBHOOK_TIMESTAMP_HEADER}: $TS" \\`,
    `  -H "${WEBHOOK_SIGNATURE_HEADER}: $SIG" \\`,
    `  -d "$BODY"`,
  ].join("\n");
  const node = [
    `import { createHmac } from "node:crypto";`,
    `const body = '${EXAMPLE_BODY}';`,
    `const ts = String(Math.floor(Date.now() / 1000));`,
    `const sig = createHmac("${algo}", process.env.WEBHOOK_SECRET).update(\`\${ts}.\${body}\`).digest("${enc}");`,
    `await fetch("${target}", {`,
    `  method: "POST",`,
    `  headers: { "content-type": "${WEBHOOK_CONTENT_TYPE}", "${WEBHOOK_TIMESTAMP_HEADER}": ts, "${WEBHOOK_SIGNATURE_HEADER}": sig },`,
    `  body,`,
    `});`,
  ].join("\n");
  const openssl = [
    `TS=$(date +%s)`,
    `printf '%s' "$TS.${EXAMPLE_BODY}" | openssl dgst -${algo} -hmac "$WEBHOOK_SECRET" -${enc}`,
  ].join("\n");
  return {
    method: "POST",
    path,
    ...(url !== undefined ? { url } : {}),
    contentType: WEBHOOK_CONTENT_TYPE,
    signature: {
      header: WEBHOOK_SIGNATURE_HEADER,
      algorithm: "HMAC-SHA256",
      encoding: "hex",
      signedPayload: WEBHOOK_SIGNED_PAYLOAD,
      timestampHeader: WEBHOOK_TIMESTAMP_HEADER,
      timestamp: "epoch seconds or milliseconds; sent as the timestamp header and signed as written",
      replayWindowMs,
      replay: `Requests whose timestamp differs from the receiver clock by more than ${replayWindowMs} ms are refused; a repeated message id is dropped.`,
    },
    examples: { curl, node, openssl },
  };
}
