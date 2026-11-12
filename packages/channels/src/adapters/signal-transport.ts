import { spawn } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import type { Readable } from "node:stream";
import { Chunk, Data, Deferred, Duration, Effect, Queue, Stream, type Scope } from "effect";
import { channelError, isChannelError, type ChannelError } from "../errors.js";

/**
 * Transport to a `signal-cli` JSON-RPC endpoint. The adapter only sees {@link SignalTransport}, so
 * tests inject a fake and production picks the spawned process or a daemon socket.
 */

/** A JSON-RPC error object returned by signal-cli. */
export class SignalRpcError extends Data.TaggedError("SignalRpcError")<{
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}> {}

/** A server-initiated JSON-RPC notification, e.g. `receive`. */
export interface SignalNotification {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** One live connection. `notifications` ends with a `network` {@link ChannelError} when it drops. */
export interface SignalConnection {
  readonly notifications: Stream.Stream<SignalNotification, ChannelError>;
  readonly request: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<unknown, SignalRpcError | ChannelError>;
}

/** Opens a {@link SignalConnection} that lives as long as the provided scope. */
export interface SignalTransport {
  readonly open: Effect.Effect<SignalConnection, ChannelError, Scope.Scope>;
  /**
   * Recent child-process stderr lines (bounded, account masked) for diagnosing a dead connection.
   * Present on the spawned-process transport. Never publish these alongside the account.
   */
  readonly diagnostics?: () => readonly string[];
}

const DEFAULT_MAX_LINE_CHARS = 1024 * 1024;
const DEFAULT_MAX_PENDING_NOTIFICATIONS = 1000;
const DEFAULT_STDERR_LINES = 50;
const DEFAULT_STDERR_LINE_CHARS = 500;

const asRecord = (u: unknown): Record<string, unknown> | undefined =>
  typeof u === "object" && u !== null && !Array.isArray(u) ? (u as Record<string, unknown>) : undefined;

/**
 * Newline-delimited JSON-RPC 2.0 over any line source and sink. Correlates responses by id,
 * queues notifications, and fails every pending request (and the notification stream) when the
 * line source ends. Non-JSON lines (signal-cli log output) are skipped.
 *
 * The notification queue never blocks the reader: a response queued behind a full notification
 * buffer would deadlock a consumer that sends while handling a message. It is capped instead
 * (`maxPendingNotifications`): past the cap the connection fails with a `too_large` error.
 * Normal backpressure is applied by the adapter's bounded inbound queue.
 */
export const makeJsonRpcConnection = (
  adapterId: string,
  io: {
    readonly lines: Stream.Stream<string, ChannelError>;
    readonly write: (line: string) => Effect.Effect<void, ChannelError>;
    readonly requestTimeout?: Duration.DurationInput;
    /** Notifications queued for the consumer before the connection fails. Default 1000. */
    readonly maxPendingNotifications?: number;
  },
): Effect.Effect<SignalConnection, never, Scope.Scope> =>
  Effect.gen(function* () {
    const maxPendingNotifications = io.maxPendingNotifications ?? DEFAULT_MAX_PENDING_NOTIFICATIONS;
    const pending = new Map<number, Deferred.Deferred<unknown, SignalRpcError | ChannelError>>();
    const queue = yield* Queue.unbounded<SignalNotification | ChannelError>();
    let nextId = 1;
    let closed: ChannelError | undefined;

    const closeAll = (error: ChannelError): Effect.Effect<void> =>
      Effect.gen(function* () {
        closed = error;
        for (const [id, deferred] of [...pending]) {
          pending.delete(id);
          yield* Deferred.fail(deferred, error);
        }
        yield* Queue.offer(queue, error);
      });

    const handleLine = (line: string): Effect.Effect<void> => {
      const trimmed = line.trim();
      if (trimmed === "") return Effect.void;
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = asRecord(JSON.parse(trimmed));
      } catch {
        return Effect.void;
      }
      if (!parsed) return Effect.void;
      if (typeof parsed.id === "number") {
        const deferred = pending.get(parsed.id);
        if (!deferred) return Effect.void;
        pending.delete(parsed.id);
        const err = asRecord(parsed.error);
        return err
          ? Deferred.fail(
              deferred,
              new SignalRpcError({
                code: typeof err.code === "number" ? err.code : -1,
                message: typeof err.message === "string" ? err.message : "signal-cli error",
                ...(err.data !== undefined ? { data: err.data } : {}),
              }),
            ).pipe(Effect.asVoid)
          : Deferred.succeed(deferred, parsed.result).pipe(Effect.asVoid);
      }
      if (typeof parsed.method === "string") {
        if (closed) return Effect.void;
        const notification = { method: parsed.method, params: asRecord(parsed.params) ?? {} };
        // Never block here (a blocked reader strands responses). A consumer that stops draining
        // gets a loud typed failure once the backlog is full, not unbounded memory growth.
        return Queue.size(queue).pipe(
          Effect.flatMap((size) =>
            size >= maxPendingNotifications
              ? closeAll(
                  channelError(adapterId, "too_large", {
                    message: `channel ${adapterId}: signal-cli notification backlog exceeded ${maxPendingNotifications}`,
                  }),
                )
              : Queue.offer(queue, notification).pipe(Effect.asVoid),
          ),
        );
      }
      return Effect.void;
    };

    yield* io.lines.pipe(
      Stream.runForEach(handleLine),
      Effect.matchEffect({
        onFailure: closeAll,
        onSuccess: () =>
          closeAll(channelError(adapterId, "network", { message: `channel ${adapterId}: signal-cli connection closed` })),
      }),
      Effect.forkScoped,
    );

    const timeout = io.requestTimeout ?? "30 seconds";
    const request: SignalConnection["request"] = (method, params) =>
      Effect.gen(function* () {
        if (closed) return yield* Effect.fail(closed);
        const id = nextId++;
        const deferred = yield* Deferred.make<unknown, SignalRpcError | ChannelError>();
        pending.set(id, deferred);
        const line = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
        yield* io.write(line).pipe(Effect.tapError(() => Effect.sync(() => void pending.delete(id))));
        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutFail({
            duration: timeout,
            onTimeout: () =>
              channelError(adapterId, "network", { message: `channel ${adapterId}: signal-cli request timed out` }),
          }),
          Effect.ensuring(Effect.sync(() => void pending.delete(id))),
        );
      });

    return {
      notifications: Stream.fromQueue(queue).pipe(
        Stream.mapEffect((item) => (isChannelError(item) ? Effect.fail(item) : Effect.succeed(item))),
      ),
      request,
    };
  });

/**
 * The only part of a failure that may be kept as an error `cause`: Node system errors carry
 * `spawnargs`, `path` and `cmd`, which for signal-cli contain the account number.
 */
export const safeCause = (cause: unknown): { readonly name: string; readonly code?: string } => {
  if (typeof cause !== "object" || cause === null) return { name: "Error" };
  const c = cause as { name?: unknown; code?: unknown };
  return {
    name: typeof c.name === "string" ? c.name : "Error",
    ...(typeof c.code === "string" ? { code: c.code } : {}),
  };
};

/** Bounded tail of a child's stderr for diagnostics, with secrets masked. */
export interface StderrRing {
  readonly push: (chunk: string) => void;
  readonly lines: () => readonly string[];
}

/**
 * Keep the last `maxLines` stderr lines (each cut to `maxLineChars`), replacing every `redact`
 * string. Memory is bounded no matter how much the child writes.
 */
export const makeStderrRing = (
  redact: readonly string[],
  maxLines = DEFAULT_STDERR_LINES,
  maxLineChars = DEFAULT_STDERR_LINE_CHARS,
): StderrRing => {
  const ring: string[] = [];
  let partial = "";
  const mask = (line: string): string =>
    redact.reduce((acc, secret) => (secret === "" ? acc : acc.split(secret).join("<redacted>")), line).slice(0, maxLineChars);
  const add = (line: string): void => {
    ring.push(mask(line));
    if (ring.length > maxLines) ring.shift();
  };
  return {
    push: (chunk) => {
      // A partial line is only ever held up to a bound that still contains any whole secret.
      const parts = (partial + chunk).split("\n");
      partial = (parts.pop() ?? "").slice(-(maxLineChars * 2));
      for (const part of parts) if (part.trim() !== "") add(part);
    },
    lines: () => (partial.trim() === "" ? [...ring] : [...ring, mask(partial)]),
  };
};

/**
 * Split a Node readable into lines; ends on close, fails with `network` on error. A line longer
 * than `maxLineChars` (a peer that never sends a newline) fails the stream with `too_large` and
 * destroys the source instead of buffering without limit.
 * @internal exported for tests.
 */
export const linesOf = (
  adapterId: string,
  readable: Readable,
  maxLineChars = DEFAULT_MAX_LINE_CHARS,
): Stream.Stream<string, ChannelError> =>
  Stream.async<string, ChannelError>((emit) => {
    let buffer = "";
    let dead = false;
    const overflow = (): void => {
      dead = true;
      buffer = "";
      void emit.fail(
        channelError(adapterId, "too_large", {
          message: `channel ${adapterId}: signal-cli line exceeds ${maxLineChars} characters`,
        }),
      );
      readable.destroy();
    };
    readable.setEncoding("utf8");
    readable.on("data", (chunk: string) => {
      if (dead) return;
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      if (buffer.length > maxLineChars || parts.some((p) => p.length > maxLineChars)) return overflow();
      const lines = parts.filter((p) => p.trim() !== "");
      if (lines.length > 0) void emit.chunk(Chunk.fromIterable(lines));
    });
    readable.on("end", () => void (dead || emit.end()));
    readable.on("close", () => void (dead || emit.end()));
    readable.on("error", (cause) =>
      void (dead || emit.fail(channelError(adapterId, "network", { message: `channel ${adapterId}: stream error`, cause: safeCause(cause) }))),
    );
  });

const writeTo = (
  adapterId: string,
  stream: { write: (data: string, cb: (err?: Error | null) => void) => unknown },
) =>
  (line: string): Effect.Effect<void, ChannelError> =>
    Effect.async<void, ChannelError>((resume) => {
      stream.write(`${line}\n`, (err) =>
        resume(
          err
            ? Effect.fail(channelError(adapterId, "network", { message: `channel ${adapterId}: write failed`, cause: safeCause(err) }))
            : Effect.void,
        ),
      );
    });

/**
 * Spawn `signal-cli ... jsonRpc` and talk over stdin/stdout. The account number is passed as a
 * CLI argument, so it is visible in the host's process list; prefer {@link makeSignalSocketTransport}
 * against a daemon on shared hosts. The process is killed when the scope closes.
 */
export const makeSignalProcessTransport = (options: {
  readonly adapterId?: string;
  readonly account: string;
  readonly command?: string;
  readonly configDir?: string;
}): SignalTransport => {
  const adapterId = options.adapterId ?? "signal";
  const stderr = makeStderrRing([options.account]);
  return {
    diagnostics: () => stderr.lines(),
    open: Effect.gen(function* () {
      const args = [
        ...(options.configDir ? ["--config", options.configDir] : []),
        "-a",
        options.account,
        "--output=json",
        "jsonRpc",
      ];
      const proc = yield* Effect.acquireRelease(
        Effect.try({
          try: () => spawn(options.command ?? "signal-cli", args, { stdio: ["pipe", "pipe", "pipe"] }),
          catch: (cause) =>
            channelError(adapterId, "network", { message: `channel ${adapterId}: cannot start signal-cli`, cause: safeCause(cause) }),
        }),
        (p) => Effect.sync(() => void p.kill("SIGTERM")),
      );
      proc.stderr?.setEncoding("utf8");
      proc.stderr?.on("data", (chunk: string) => stderr.push(chunk));
      const failed = yield* Deferred.make<never, ChannelError>();
      proc.on("error", (cause) =>
        void Effect.runFork(
          // Spawn errors carry `spawnargs` (the account number): keep only name and code.
          Deferred.fail(
            failed,
            channelError(adapterId, "network", { message: `channel ${adapterId}: signal-cli failed`, cause: safeCause(cause) }),
          ),
        ),
      );
      if (!proc.stdout || !proc.stdin) {
        return yield* Effect.fail(channelError(adapterId, "network", { message: `channel ${adapterId}: no stdio` }));
      }
      return yield* makeJsonRpcConnection(adapterId, {
        lines: Stream.merge(linesOf(adapterId, proc.stdout), Stream.fromEffect(Deferred.await(failed)).pipe(Stream.drain)),
        write: writeTo(adapterId, proc.stdin),
      });
    }),
  };
};

/** Connect to a running `signal-cli daemon --tcp host:port` (or `--socket path`). */
export const makeSignalSocketTransport = (options: {
  readonly adapterId?: string;
  readonly host?: string;
  readonly port?: number;
  readonly path?: string;
}): SignalTransport => {
  const adapterId = options.adapterId ?? "signal";
  return {
    open: Effect.gen(function* () {
      const socket: Socket = yield* Effect.acquireRelease(
        Effect.async<Socket, ChannelError>((resume) => {
          const s =
            options.path !== undefined
              ? createConnection({ path: options.path })
              : createConnection({ host: options.host ?? "127.0.0.1", port: options.port ?? 7583 });
          s.once("connect", () => resume(Effect.succeed(s)));
          s.once("error", (cause) =>
            resume(Effect.fail(channelError(adapterId, "network", { message: `channel ${adapterId}: cannot connect to signal-cli`, cause: safeCause(cause) }))),
          );
        }),
        (s) => Effect.sync(() => void s.destroy()),
      );
      return yield* makeJsonRpcConnection(adapterId, {
        lines: linesOf(adapterId, socket),
        write: writeTo(adapterId, socket),
      });
    }),
  };
};
