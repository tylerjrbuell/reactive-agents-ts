import { Effect, Redacted } from "effect";
import { channelError, type ChannelError } from "../errors.js";
import { mapTelegramFailure, parseTelegramFailure, redactToken } from "./telegram-protocol.js";

/** The slice of `fetch` the client needs. Tests inject a fake Bot API server here. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A file to upload with a Bot API method (`sendPhoto`, `sendDocument`). */
export interface TelegramUpload {
  readonly filename: string;
  readonly contentType: string;
  readonly data: Uint8Array;
}

export interface TelegramApiOptions {
  readonly adapterId: string;
  readonly token: Redacted.Redacted<string>;
  readonly fetch?: FetchLike;
  /** Default `https://api.telegram.org`. */
  readonly apiBaseUrl?: string;
}

/** Thin, typed Bot API client. The token is placed in the request URL here and nowhere else. */
export interface TelegramApi {
  /** Call a Bot API method; resolves to `result` or fails with a typed {@link ChannelError}. */
  readonly call: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
    options?: { readonly timeoutMs?: number; readonly files?: Readonly<Record<string, TelegramUpload>> },
  ) => Effect.Effect<unknown, ChannelError>;
  /** Download a file by the `file_path` that `getFile` returned. */
  readonly download: (filePath: string) => Effect.Effect<Uint8Array, ChannelError>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Keep only what is safe to retain from a thrown fetch failure: its name and code, never its text or URL. */
const safeCause = (cause: unknown): { readonly name?: string; readonly code?: string } => {
  if (typeof cause !== "object" || cause === null) return {};
  const c = cause as { name?: unknown; code?: unknown };
  return {
    ...(typeof c.name === "string" ? { name: c.name } : {}),
    ...(typeof c.code === "string" ? { code: c.code } : {}),
  };
};

const toForm = (
  params: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, TelegramUpload>>,
): FormData => {
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  for (const [field, f] of Object.entries(files)) {
    form.append(field, new Blob([f.data as BlobPart], { type: f.contentType }), f.filename);
  }
  return form;
};

/** Build a {@link TelegramApi}. Failures are mapped by `mapTelegramFailure`; transport errors are `network`. */
export const makeTelegramApi = (options: TelegramApiOptions): TelegramApi => {
  const { adapterId } = options;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const base = (options.apiBaseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
  const scrub = (text: string): string => redactToken(text, Redacted.value(options.token));

  const network = (cause: unknown): ChannelError =>
    channelError(adapterId, "network", {
      message: `channel ${adapterId}: telegram request failed`,
      cause: safeCause(cause),
    });

  const fetchWith = (url: string, init: RequestInit, timeoutMs: number): Effect.Effect<Response, ChannelError> =>
    Effect.tryPromise({
      try: (signal) => doFetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) }),
      catch: network,
    });

  const readText = (res: Response): Effect.Effect<string, ChannelError> =>
    Effect.tryPromise({ try: () => res.text(), catch: network });

  const call: TelegramApi["call"] = (method, params = {}, opts = {}) =>
    Effect.gen(function* () {
      const url = `${base}/bot${Redacted.value(options.token)}/${method}`;
      const init: RequestInit = opts.files
        ? { method: "POST", body: toForm(params, opts.files) }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) };
      const res = yield* fetchWith(url, init, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const text = yield* readText(res);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      const b = typeof body === "object" && body !== null ? (body as { ok?: unknown; result?: unknown }) : undefined;
      if (b?.ok === true) return b.result;
      if (b === undefined && res.ok) {
        return yield* Effect.fail(channelError(adapterId, "unknown", { message: `channel ${adapterId}: telegram returned a non-JSON body` }));
      }
      return yield* Effect.fail(mapTelegramFailure(adapterId, parseTelegramFailure(res.status, body), scrub));
    });

  const download: TelegramApi["download"] = (filePath) =>
    Effect.gen(function* () {
      const url = `${base}/file/bot${Redacted.value(options.token)}/${filePath}`;
      const res = yield* fetchWith(url, { method: "GET" }, DEFAULT_TIMEOUT_MS * 4);
      if (!res.ok) {
        return yield* Effect.fail(mapTelegramFailure(adapterId, { httpStatus: res.status }, scrub));
      }
      const buffer = yield* Effect.tryPromise({ try: () => res.arrayBuffer(), catch: network });
      return new Uint8Array(buffer);
    });

  return { call, download };
};
