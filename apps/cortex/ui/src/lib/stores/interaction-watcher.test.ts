import { describe, expect, test, afterEach } from "bun:test";
import { get } from "svelte/store";
import { startInteractionWatcher, pendingInteractions } from "./interaction-watcher.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  pendingInteractions.set([]);
});

describe("interaction-watcher", () => {
  test("polls pending-interactions and exposes them via the store", async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("pending-interactions")) {
        calls += 1;
        return new Response(
          JSON.stringify({
            interactions: [
              {
                runId: "r1",
                interactionId: "i1",
                kind: "choice",
                prompt: "Pick",
                schema: { options: ["a"] },
                task: "t",
                updatedAt: 1,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const stop = startInteractionWatcher(10);
    await new Promise((r) => setTimeout(r, 40));
    stop();

    expect(calls).toBeGreaterThan(0);
    const state = get(pendingInteractions);
    expect(state.length).toBe(1);
    expect(state[0]?.interactionId).toBe("i1");
    expect(state[0]?.kind).toBe("choice");
  });

  test("clears the store once the server reports no pending interactions", async () => {
    let empty = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("pending-interactions")) {
        return new Response(
          JSON.stringify({ interactions: empty ? [] : [{ runId: "r2", interactionId: "i2", kind: "confirmation", prompt: "Sure?", schema: {}, task: "t", updatedAt: 1 }] }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const stop = startInteractionWatcher(10);
    await new Promise((r) => setTimeout(r, 25));
    expect(get(pendingInteractions).length).toBe(1);

    empty = true;
    await new Promise((r) => setTimeout(r, 25));
    stop();
    expect(get(pendingInteractions).length).toBe(0);
  });
});
