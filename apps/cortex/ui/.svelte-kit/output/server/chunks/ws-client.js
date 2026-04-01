import { l as ssr_context, g as getContext } from "./index2.js";
import "clsx";
import "@sveltejs/kit/internal";
import "./exports.js";
import "./utils.js";
import "@sveltejs/kit/internal/server";
import "./root.js";
import "./state.svelte.js";
import { w as writable } from "./index.js";
import { W as WS_BASE, R as RECONNECT_DELAYS_MS } from "./constants.js";
function onDestroy(fn) {
  /** @type {SSRContext} */
  ssr_context.r.on_destroy(fn);
}
const getStores = () => {
  const stores$1 = getContext("__svelte__");
  return {
    /** @type {typeof page} */
    page: {
      subscribe: stores$1.page.subscribe
    },
    /** @type {typeof navigating} */
    navigating: {
      subscribe: stores$1.navigating.subscribe
    },
    /** @type {typeof updated} */
    updated: stores$1.updated
  };
};
const page = {
  subscribe(fn) {
    const store = getStores().page;
    return store.subscribe(fn);
  }
};
const clients = /* @__PURE__ */ new Map();
function createInternal(url) {
  const status = writable("connecting");
  const handlers = /* @__PURE__ */ new Set();
  const internal = {
    ws: null,
    status,
    handlers,
    retryIndex: 0,
    retryTimer: null,
    closed: false
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
        const data = JSON.parse(e.data);
        for (const h of internal.handlers) h(data);
      } catch {
      }
    };
    ws.onclose = () => {
      if (internal.closed) {
        internal.status.set("disconnected");
        return;
      }
      const delay = RECONNECT_DELAYS_MS[Math.min(internal.retryIndex, RECONNECT_DELAYS_MS.length - 1)] ?? 3e4;
      internal.retryIndex++;
      internal.retryTimer = setTimeout(connect, delay);
    };
    ws.onerror = () => {
    };
  };
  connect();
  return internal;
}
function createWsClient(path) {
  const url = `${WS_BASE}${path}`;
  if (!clients.has(url)) {
    clients.set(url, createInternal(url));
  }
  const internal = clients.get(url);
  return {
    status: internal.status,
    send: (msg) => {
      if (internal.ws?.readyState === WebSocket.OPEN) {
        internal.ws.send(JSON.stringify(msg));
      }
    },
    close: () => {
      internal.closed = true;
      if (internal.retryTimer) clearTimeout(internal.retryTimer);
      internal.ws?.close();
      clients.delete(url);
    },
    onMessage: (handler) => {
      internal.handlers.add(handler);
      return () => internal.handlers.delete(handler);
    }
  };
}
export {
  createWsClient as c,
  onDestroy as o,
  page as p
};
