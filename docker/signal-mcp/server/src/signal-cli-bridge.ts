import { spawn, type ChildProcess } from "node:child_process";

/** JSON-RPC 2.0 request shape sent to signal-cli. */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response from signal-cli. */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** A received Signal message notification. */
export interface SignalNotification {
  method: string;
  params: Record<string, unknown>;
}

/**
 * Persistent bridge to signal-cli running in `jsonRpc` mode.
 *
 * Spawns `signal-cli -a <userId> jsonRpc` as a long-lived subprocess.
 * All communication is newline-delimited JSON-RPC over stdin/stdout.
 *
 * - Outbound requests are correlated by `id` to pending promises.
 * - Inbound notifications (no `id`) are buffered for `drainNotifications()`.
 */
export class SignalCliBridge {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private notifications: SignalNotification[] = [];
  private buffer = "";
  private shutdownRequested = false;

  /** Optional callback invoked immediately when a notification arrives. */
  onMessageCallback: ((notification: SignalNotification) => void) | null = null;

  constructor(
    private readonly userId: string,
    private readonly configDir: string = "/data",
  ) {}

  /** Spawn signal-cli in jsonRpc mode. Resolves when the process is started. */
  start(): void {
    if (this.proc) return;

    this.proc = spawn(
      "signal-cli",
      ["--config", this.configDir, "-a", this.userId, "jsonRpc"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    // Forward stderr to our stderr (visible in Docker logs).
    // Never write to stdout — it's reserved for MCP protocol.
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    // Newline-delimited JSON reader on stdout
    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");

      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: JsonRpcResponse;
        try {
          parsed = JSON.parse(trimmed) as JsonRpcResponse;
        } catch {
          // Not valid JSON (e.g., signal-cli log line) — skip
          continue;
        }

        if (parsed.id != null) {
          // Response to a request we sent
          const entry = this.pending.get(parsed.id);
          if (entry) {
            this.pending.delete(parsed.id);
            if (parsed.error) {
              entry.reject(
                new Error(
                  `signal-cli error ${parsed.error.code}: ${parsed.error.message}`,
                ),
              );
            } else {
              entry.resolve(parsed.result);
            }
          }
        } else {
          // Notification (receive, etc.) — buffer it
          const notification: SignalNotification = {
            method: (parsed as any).method ?? "unknown",
            params: (parsed as any).params ?? {},
          };
          this.notifications.push(notification);
          // Invoke immediate callback if registered
          this.onMessageCallback?.(notification);
        }
      }
    });

    this.proc.on("exit", (code) => {
      if (!this.shutdownRequested) {
        process.stderr.write(
          `signal-cli exited unexpectedly with code ${code}\n`,
        );
      }
      // Reject all pending requests
      for (const [id, entry] of this.pending) {
        this.pending.delete(id);
        entry.reject(new Error(`signal-cli exited (code ${code})`));
      }
      this.proc = null;
    });
  }

  /** Send a JSON-RPC request and wait for the response. */
  async request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.proc?.stdin?.writable) {
      throw new Error("signal-cli not running");
    }

    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method };
    if (params) req.params = params;

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin!.write(JSON.stringify(req) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /** Drain buffered notifications (received messages). */
  drainNotifications(): SignalNotification[] {
    const drained = this.notifications;
    this.notifications = [];
    return drained;
  }

  /** Graceful shutdown — kill signal-cli process. */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    if (!this.proc) return;

    return new Promise<void>((resolve) => {
      this.proc!.on("exit", () => resolve());
      this.proc!.kill("SIGTERM");

      // Force kill after 5s if still alive
      setTimeout(() => {
        if (this.proc) {
          this.proc.kill("SIGKILL");
        }
        resolve();
      }, 5000);
    });
  }
}
