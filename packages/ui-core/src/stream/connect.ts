import {
  isTerminalEvent,
  parseUiStreamEvent,
  type SeqStamped,
  type UiStreamEvent,
} from "../protocol/events.js";

export interface ConnectOptions {
  readonly endpoint: string;
  readonly body?: Record<string, unknown>;
  readonly attach?: { readonly runId: string; readonly cursor?: number };
  readonly fetchImpl?: typeof fetch;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const attachUrl = (endpoint: string, runId: string, cursor: number | undefined): string => {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  const q = cursor !== undefined ? `?cursor=${cursor}` : "";
  return `${base}/${encodeURIComponent(runId)}${q}`;
};

async function* readSse(
  res: Response,
): AsyncGenerator<SeqStamped<UiStreamEvent>> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingSeq: number | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("id: ")) {
        const n = Number(line.slice(4).trim());
        pendingSeq = Number.isFinite(n) ? n : undefined;
        continue;
      }
      if (!line.startsWith("data: ")) continue;
      const event = parseUiStreamEvent(line.slice(6).trim());
      if (event === null) continue;
      const stamped: SeqStamped<UiStreamEvent> =
        pendingSeq !== undefined ? { ...event, seq: pendingSeq } : event;
      pendingSeq = undefined;
      yield stamped;
    }
  }
}

/**
 * Connect to an agent run stream with automatic cursor-based resume.
 * New-run mode: POST { ...body } to endpoint.
 * Attach mode (or reconnect): GET endpoint/:runId?cursor=N.
 */
export async function* connectRunStream(
  opts: ConnectOptions,
): AsyncGenerator<SeqStamped<UiStreamEvent>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.retryDelayMs ?? 500;

  let lastSeq: number | undefined = opts.attach?.cursor;
  let attempt = 0;
  let firstConnection = true;

  for (;;) {
    try {
      const res =
        firstConnection && opts.body !== undefined
          ? await fetchImpl(opts.endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(opts.body),
              signal: opts.signal,
            })
          : await fetchImpl(
              attachUrl(opts.endpoint, opts.attach?.runId ?? "", lastSeq),
              { method: "GET", signal: opts.signal },
            );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      firstConnection = false;
      attempt = 0; // successful connection resets the retry budget

      for await (const event of readSse(res)) {
        if (event.seq !== undefined) lastSeq = event.seq;
        yield event;
        if (isTerminalEvent(event)) return;
      }
      // Stream ended without a terminal event → treat as a drop.
      throw new Error("stream ended before terminal event");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        yield { _tag: "StreamCancelled", reason: "aborted", iterationsCompleted: 0 };
        return;
      }
      const canReconnect = opts.attach?.runId !== undefined && attempt < maxRetries;
      if (!canReconnect) {
        const cause = err instanceof Error ? err.message : String(err);
        yield { _tag: "StreamError", cause };
        return;
      }
      attempt += 1;
      await sleep(baseDelay * 2 ** (attempt - 1));
    }
  }
}
