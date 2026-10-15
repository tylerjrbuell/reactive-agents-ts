// packages/llm-provider/tests/stream-eof-retry.test.ts
// Run: bun test packages/llm-provider/tests/stream-eof-retry.test.ts --timeout 15000
//
// GH (user report, trace 01M4V5GH4H43KJDCA3EC0JGVZW) — a server-side stream
// drop surfaces as a bare `EOF` read error. The classifier must tag it
// transient (see provider-error-transient.test.ts) so the EXISTING
// pre-first-emission guard in retryStreamBeforeFirstEmission retries it.
// These arms pin the wrapper-level contract end-to-end:
//   1. EOF BEFORE any emission → retried, second attempt succeeds, caller
//      sees one clean stream (attempts = 2).
//   2. EOF AFTER first emission → surfaces unretried (no silent restart, no
//      duplicated deltas), attempts stays 1.

import { describe, it, expect } from "bun:test";
import { Effect, Stream, Chunk } from "effect";
import { retryStreamBeforeFirstEmission } from "../src/retry.js";
import { mapProviderError } from "../src/provider-error.js";
import type { StreamEvent } from "../src/types.js";

const eofFailure = () => mapProviderError(new Error("EOF"), "ollama", "qwen3.5");

const delta = (text: string): StreamEvent => ({ type: "text_delta", text });

describe("retryStreamBeforeFirstEmission — EOF-class stream drops", () => {
  it("EOF before first emission: retried, caller sees attempt-2 output once", async () => {
    let attempts = 0;
    const flaky = Stream.suspend<StreamEvent, ReturnType<typeof eofFailure>, never>(
      () => {
        attempts += 1;
        if (attempts === 1) return Stream.fail(eofFailure());
        return Stream.fromIterable([delta("hello"), delta(" world")]);
      },
    );

    const events = await Effect.runPromise(
      Stream.runCollect(retryStreamBeforeFirstEmission(flaky)),
    );

    expect(attempts).toBe(2);
    const texts = Chunk.toArray(events).map((e) =>
      e.type === "text_delta" ? e.text : "",
    );
    expect(texts).toEqual(["hello", " world"]);
  }, 15_000);

  it("EOF after first emission: surfaces unretried, no duplicated output", async () => {
    let attempts = 0;
    const dropsMidway = Stream.suspend<StreamEvent, ReturnType<typeof eofFailure>, never>(
      () => {
        attempts += 1;
        // One delta emitted, THEN the drop — the emittedAny latch must
        // keep the schedule from restarting (partial-output duplication
        // is worse than a surfaced failure).
        return Stream.concat(Stream.make(delta("partial")), Stream.fail(eofFailure()));
      },
    );

    const collected: StreamEvent[] = [];
    const exit = await Effect.runPromise(
      Stream.runForEach(retryStreamBeforeFirstEmission(dropsMidway), (ev) =>
        Effect.sync(() => collected.push(ev)),
      ).pipe(Effect.exit),
    );

    expect(exit._tag).toBe("Failure");
    expect(attempts).toBe(1); // never restarted
    expect(collected.map((e) => (e.type === "text_delta" ? e.text : ""))).toEqual([
      "partial",
    ]);
  }, 15_000);

  it("non-EOF permanent failure before first emission: still NOT retried (no blanket retry)", async () => {
    let attempts = 0;
    const rejected = Stream.suspend<StreamEvent, ReturnType<typeof mapProviderError>, never>(
      () => {
        attempts += 1;
        return Stream.fail(
          mapProviderError({ status: 401, message: "unauthorized" }, "ollama"),
        );
      },
    );

    const exit = await Effect.runPromise(
      Stream.runDrain(retryStreamBeforeFirstEmission(rejected)).pipe(Effect.exit),
    );

    expect(exit._tag).toBe("Failure");
    expect(attempts).toBe(1);
  }, 15_000);
});
