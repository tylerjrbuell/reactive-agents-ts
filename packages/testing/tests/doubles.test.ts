// Run: bun test packages/testing/tests/doubles.test.ts --timeout 15000
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  fakeWriteStream,
  jsonResponse,
  sseResponse,
  stubFetch,
  textResponse,
} from "../src/index.js";

describe("stubFetch", () => {
  test("returns the handler's Response and normalizes the request", async () => {
    const seen: Request[] = [];
    const reply = textResponse("pong", { status: 201 });
    const fetchFn = stubFetch((req) => {
      seen.push(req);
      return reply;
    }) satisfies typeof globalThis.fetch;

    const res = await fetchFn("https://example.test/ping", { method: "POST", body: "hi" });
    expect(res).toBe(reply);
    expect(res.status).toBe(201);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe("https://example.test/ping");
    expect(await seen[0]?.text()).toBe("hi");
  });

  test("accepts async handlers and is assignable to globalThis.fetch", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = stubFetch(async () => jsonResponse({ ok: true }));
      const res = await fetch("https://example.test/json");
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("fakeWriteStream", () => {
  test("output() captures writes synchronously", () => {
    const { stream, output } = fakeWriteStream();
    stream.write("hello ");
    stream.write(Buffer.from("world"));
    expect(output()).toBe("hello world");
  });

  test("reports TTY options", () => {
    const tty = fakeWriteStream({ isTTY: true, columns: 120 }).stream;
    expect(tty.isTTY).toBe(true);
    expect(tty.columns).toBe(120);
    expect(tty.getWindowSize()).toEqual([120, 24]);
    expect(tty.hasColors()).toBe(true);

    const plain = fakeWriteStream().stream;
    expect(plain.isTTY).toBe(false);
    expect(plain.hasColors()).toBe(false);
  });
});

describe("response builders", () => {
  test("sseResponse streams data lines", async () => {
    const res = sseResponse([{ a: 1 }, "[DONE]"]);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe('data: {"a":1}\n\ndata: [DONE]\n\n');
  });
});

describe("double sources", () => {
  test("contain zero double casts", () => {
    const dir = resolve(import.meta.dir, "../src/doubles");
    const needle = ["as", "unknown", "as"].join(" ");
    for (const file of ["fetch.ts", "write-stream.ts", "response.ts"]) {
      const src = readFileSync(join(dir, file), "utf-8");
      expect({ file, hits: src.split(needle).length - 1 }).toEqual({ file, hits: 0 });
    }
  });
});
