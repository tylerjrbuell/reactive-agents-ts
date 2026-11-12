import type { FetchLike } from "../../src/adapters/telegram-api.js";

/** A fake bot token. The leak cases hunt for it in every surface the adapter exposes. */
export const FAKE_TOKEN = "123456:AAFakeBotTokenForTestsOnly_abcdef123";
export const BOT_ID = 123456;
export const BOT_USERNAME = "ra_test_bot";

export interface FakeSend {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly files: Readonly<Record<string, { filename: string; contentType: string; data: Uint8Array }>>;
}

interface Queued {
  readonly id: number;
  readonly body: Record<string, unknown>;
  readonly confirmed: Promise<void>;
  readonly confirm: () => void;
}

export interface FakeTelegram {
  readonly fetch: FetchLike;
  /** Queue an update. The returned promise resolves once the adapter polled past it (offset > update_id). */
  readonly push: (update: Record<string, unknown>) => { readonly updateId: number; readonly confirmed: Promise<void> };
  /** Successful `send*` calls, in order. */
  readonly sends: FakeSend[];
  /** Every Bot API method called, in order (including polls). */
  readonly methods: string[];
  /** The `offset` of each `getUpdates` call. */
  readonly pollOffsets: number[];
  /** Fail the next `send*` call with this HTTP status and body. */
  readonly failNextSend: (failure: { status: number; body: unknown }) => void;
  /** Fail the next `getUpdates` call with this HTTP status and body. */
  readonly failNextPoll: (failure: { status: number; body: unknown }) => void;
  /** Reset the in-flight (or next) long poll like a dropped socket. */
  readonly dropConnection: () => void;
  readonly addFile: (fileId: string, data: Uint8Array) => void;
  /** Every URL requested, to prove the token never escapes into reported text. */
  readonly urls: string[];
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ok = (result: unknown): Response => json(200, { ok: true, result });

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

/** In-memory Bot API server: `getMe`, `getUpdates` (long poll), `getFile`, `send*`, `setWebhook`, file download. */
export const makeFakeTelegram = (options: { readonly batchSize?: number } = {}): FakeTelegram => {
  const batchSize = options.batchSize ?? 1;
  const queue: Queued[] = [];
  const sends: FakeSend[] = [];
  const methods: string[] = [];
  const pollOffsets: number[] = [];
  const urls: string[] = [];
  const files = new Map<string, Uint8Array>();
  const waiters = new Set<() => void>();
  let nextUpdateId = 1000;
  let nextMessageId = 5000;
  let dropPending = false;
  let sendFailure: { status: number; body: unknown } | undefined;
  let pollFailure: { status: number; body: unknown } | undefined;

  const wake = () => {
    for (const w of [...waiters]) w();
  };

  const push: FakeTelegram["push"] = (update) => {
    const id = nextUpdateId++;
    let confirm = () => {};
    const confirmed = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    queue.push({ id, body: { ...update, update_id: id }, confirmed, confirm });
    wake();
    return { updateId: id, confirmed };
  };

  const waitForChange = (signal: AbortSignal | null | undefined): Promise<void> =>
    new Promise((resolve, reject) => {
      const done = () => {
        waiters.delete(done);
        resolve();
      };
      waiters.add(done);
      signal?.addEventListener(
        "abort",
        () => {
          waiters.delete(done);
          reject(abortError());
        },
        { once: true },
      );
    });

  const readParams = async (init: RequestInit | undefined): Promise<{ params: Record<string, unknown>; uploads: FakeSend["files"] }> => {
    const body = init?.body;
    if (typeof body === "string") return { params: JSON.parse(body) as Record<string, unknown>, uploads: {} };
    if (body instanceof FormData) {
      const params: Record<string, unknown> = {};
      const uploads: Record<string, { filename: string; contentType: string; data: Uint8Array }> = {};
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") params[key] = value;
        else uploads[key] = { filename: value.name, contentType: value.type, data: new Uint8Array(await value.arrayBuffer()) };
      }
      return { params, uploads };
    }
    return { params: {}, uploads: {} };
  };

  const getUpdates = async (params: Record<string, unknown>, signal: AbortSignal | null | undefined): Promise<Response> => {
    const offset = typeof params.offset === "number" ? params.offset : 0;
    pollOffsets.push(offset);
    for (const u of queue) if (u.id < offset) u.confirm();
    for (;;) {
      if (pollFailure) {
        const f = pollFailure;
        pollFailure = undefined;
        return json(f.status, f.body);
      }
      if (dropPending) {
        dropPending = false;
        throw Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" });
      }
      const next = queue.filter((u) => u.id >= offset).slice(0, batchSize);
      if (next.length > 0) return ok(next.map((u) => u.body));
      await waitForChange(signal);
    }
  };

  const fetchImpl: FetchLike = async (input, init) => {
    urls.push(input);
    const m = /^https:\/\/api\.telegram\.org\/(file\/)?bot([^/]+)\/(.+)$/.exec(input);
    if (!m) return json(404, { ok: false, error_code: 404, description: "Not Found" });
    if (m[2] !== FAKE_TOKEN) return json(401, { ok: false, error_code: 401, description: "Unauthorized" });
    if (m[1]) {
      const data = files.get((m[3] ?? "").replace(/^files\//, ""));
      return data ? new Response(data as BodyInit) : json(404, { ok: false, error_code: 404, description: "Not Found" });
    }
    const method = m[3] ?? "";
    methods.push(method);
    const { params, uploads } = await readParams(init);
    switch (method) {
      case "getMe":
        return ok({ id: BOT_ID, is_bot: true, first_name: "RA Test", username: BOT_USERNAME });
      case "getUpdates":
        return getUpdates(params, init?.signal);
      case "getFile": {
        const fileId = String(params.file_id);
        const data = files.get(fileId);
        return data
          ? ok({ file_id: fileId, file_path: `files/${fileId}`, file_size: data.length })
          : json(400, { ok: false, error_code: 400, description: "Bad Request: wrong file_id" });
      }
      case "setWebhook":
        sends.push({ method, params, files: {} });
        return ok(true);
      case "sendMessage":
      case "sendPhoto":
      case "sendDocument": {
        if (sendFailure) {
          const f = sendFailure;
          sendFailure = undefined;
          return json(f.status, f.body);
        }
        sends.push({ method, params, files: uploads });
        return ok({
          message_id: nextMessageId++,
          date: 1_700_000_000,
          chat: { id: params.chat_id },
          from: { id: BOT_ID, is_bot: true, username: BOT_USERNAME },
          ...(typeof params.text === "string" ? { text: params.text } : {}),
        });
      }
      default:
        return json(404, { ok: false, error_code: 404, description: "Not Found" });
    }
  };

  return {
    fetch: fetchImpl,
    push,
    sends,
    methods,
    pollOffsets,
    urls,
    failNextSend: (f) => {
      sendFailure = f;
    },
    failNextPoll: (f) => {
      pollFailure = f;
      wake();
    },
    dropConnection: () => {
      dropPending = true;
      wake();
    },
    addFile: (fileId, data) => {
      files.set(fileId, data);
    },
  };
};
