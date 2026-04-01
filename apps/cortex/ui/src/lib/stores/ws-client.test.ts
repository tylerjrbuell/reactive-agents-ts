import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { get } from "svelte/store";
import { createWsClient, resetWsClientsForTests } from "./ws-client.js";

type WsHooks = {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
};

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  resetWsClientsForTests();
});

afterEach(() => {
  resetWsClientsForTests();
  globalThis.WebSocket = OriginalWebSocket;
});

describe("createWsClient", () => {
  it("deduplicates clients for the same path (same store reference)", async () => {
    let constructed = 0;
    globalThis.WebSocket = class MockWs {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = MockWs.OPEN;
      url: string;
      onopen: WsHooks["onopen"] = null;
      onmessage: WsHooks["onmessage"] = null;
      onclose: WsHooks["onclose"] = null;
      onerror: WsHooks["onerror"] = null;
      constructor(url: string | URL) {
        this.url = String(url);
        constructed++;
        queueMicrotask(() => this.onopen?.(new Event("open")));
      }
      send() {}
      close() {
        this.readyState = MockWs.CLOSED;
        this.onclose?.(new CloseEvent("close"));
      }
    } as unknown as typeof WebSocket;

    const a = createWsClient("/ws/live/test-agent");
    const b = createWsClient("/ws/live/test-agent");
    expect(constructed).toBe(1);
    expect(a.status).toBe(b.status);
    await new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));
    expect(get(a.status)).toBe("connected");
    a.close();
  });

  it("onMessage receives parsed JSON payloads", async () => {
    let constructed = 0;
    let lastInstance: InstanceType<typeof MockWs> | null = null;

    class MockWs {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = MockWs.OPEN;
      url: string;
      onopen: WsHooks["onopen"] = null;
      onmessage: WsHooks["onmessage"] = null;
      onclose: WsHooks["onclose"] = null;
      onerror: WsHooks["onerror"] = null;
      constructor(url: string | URL) {
        this.url = String(url);
        constructed++;
        lastInstance = this;
        queueMicrotask(() => this.onopen?.(new Event("open")));
      }
      send() {}
      close() {
        this.readyState = MockWs.CLOSED;
        this.onclose?.(new CloseEvent("close"));
      }
    }

    globalThis.WebSocket = MockWs as unknown as typeof WebSocket;

    const client = createWsClient("/ws/live/ingest-test");
    const received: unknown[] = [];
    client.onMessage((d) => received.push(d));

    await new Promise((r) => queueMicrotask(r));
    lastInstance?.onmessage?.(new MessageEvent("message", { data: '{"hello":1}' }));
    expect(received).toEqual([{ hello: 1 }]);

    client.close();
  });
});
