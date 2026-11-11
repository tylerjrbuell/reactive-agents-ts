import { writable } from "svelte/store";
import { WS_BASE, RECONNECT_DELAYS_MS } from "../constants.js";

export type WsStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface WsClient {
  readonly status: ReturnType<typeof writable<WsStatus>>;
  readonly send: (msg: unknown) => void;
  readonly close: () => void;
  readonly onMessage: (handler: (data: unknown) => void) => () => void;
}

const clients = new Map<string, WsClientInternal>();

/** Test-only: reset deduplication map (closes sockets). */
export function resetWsClientsForTests(): void {
  for (const internal of clients.values()) {
    internal.closed = true;
    if (internal.retryTimer) clearTimeout(internal.retryTimer);
    internal.ws?.close();
  }
  clients.clear();
}

interface WsClientInternal {
  ws: WebSocket | null;
  status: ReturnType<typeof writable<WsStatus>>;
  handlers: Set<(data: unknown) => void>;
  retryIndex: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  /** Open handles sharing this socket; it closes when the last one closes. */
  refs: number;
}

function createInternal(url: string): WsClientInternal {
  const status = writable<WsStatus>("connecting");
  const handlers = new Set<(data: unknown) => void>();
  const internal: WsClientInternal = {
    ws: null,
    status,
    handlers,
    retryIndex: 0,
    retryTimer: null,
    closed: false,
    refs: 0,
  };

  const connect = () => {
    if (internal.closed) return;
    internal.status.set(internal.retryIndex > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(url);
    internal.ws = ws;

    ws.onopen = () => {
      internal.retryIndex = 0;
      internal.status.set("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as unknown;
        for (const h of internal.handlers) h(data);
      } catch {
        /* malformed — ignore */
      }
    };

    ws.onclose = () => {
      if (internal.closed) {
        internal.status.set("disconnected");
        return;
      }
      const delay =
        RECONNECT_DELAYS_MS[Math.min(internal.retryIndex, RECONNECT_DELAYS_MS.length - 1)] ?? 30000;
      internal.retryIndex++;
      internal.retryTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      /* onclose will fire next */
    };
  };

  connect();
  return internal;
}

export function createWsClient(path: string): WsClient {
  const url = `${WS_BASE}${path}`;

  if (!clients.has(url)) {
    clients.set(url, createInternal(url));
  }

  const internal = clients.get(url)!;
  internal.refs++;
  let released = false;

  return {
    status: internal.status,

    send: (msg) => {
      if (internal.ws?.readyState === WebSocket.OPEN) {
        internal.ws.send(JSON.stringify(msg));
      }
    },

    // Releases this handle. The shared socket closes only when no other handle holds it:
    // the Trace page closing its handle must not cut the layout's toasts / Beacon feed.
    close: () => {
      if (released) return;
      released = true;
      internal.refs--;
      if (internal.refs > 0) return;
      internal.closed = true;
      if (internal.retryTimer) clearTimeout(internal.retryTimer);
      internal.ws?.close();
      if (clients.get(url) === internal) clients.delete(url);
    },

    onMessage: (handler) => {
      internal.handlers.add(handler);
      return () => internal.handlers.delete(handler);
    },
  };
}
