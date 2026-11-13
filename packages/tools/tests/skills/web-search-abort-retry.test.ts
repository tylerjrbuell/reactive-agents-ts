// Run: bun test packages/tools/tests/skills/web-search-abort-retry.test.ts --timeout 20000
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Fiber } from "effect";
import { makeWebSearchHandler } from "../../src/skills/web-search.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const braveRows = { web: { results: [{ title: "B", url: "https://b.example", description: "d" }] } };

describe("web-search interruption and retry hygiene", () => {
  it("interrupting the handler aborts the in-flight fetch", async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const fetchStarted = new Promise<void>((r) => (started = r));
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      started();
      return new Promise<Response>((_res, rej) => {
        signal?.addEventListener("abort", () => rej(new Error("aborted")));
      });
    }) as typeof fetch;

    const fiber = Effect.runFork(
      makeWebSearchHandler({ apiKeys: { brave: "k" }, providers: ["brave"] })({ query: "q" }),
    );
    await fetchStarted;
    expect(signal?.aborted).toBe(false);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(signal?.aborted).toBe(true);
  });

  it("cancels the body of a retried response before the next attempt", async () => {
    let cancelled = false;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        const body = new ReadableStream<Uint8Array>({
          pull() {},
          cancel() {
            cancelled = true;
          },
        });
        return new Response(body, { status: 503 });
      }
      return new Response(JSON.stringify(braveRows), { status: 200 });
    }) as typeof fetch;

    const r = await Effect.runPromise(
      makeWebSearchHandler({ apiKeys: { brave: "k" }, providers: ["brave"] })({ query: "q" }),
    );
    expect(r.provider).toBe("brave");
    expect(calls).toBe(2);
    expect(cancelled).toBe(true);
  });
});
