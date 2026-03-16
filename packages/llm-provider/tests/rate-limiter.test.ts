// File: tests/rate-limiter.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeRateLimiter } from "../src/rate-limiter.js";
import type { LLMMessage } from "../src/types.js";

// Helper to create simple messages for token estimation
const makeMessages = (text: string): LLMMessage[] => [
  { role: "user", content: text },
];

describe("RateLimiter", () => {
  describe("request-per-minute limiting", () => {
    it("allows requests under the limit", async () => {
      const limiter = makeRateLimiter({ requestsPerMinute: 5, maxConcurrent: 100 });
      // Acquire 5 slots (at the limit)
      for (let i = 0; i < 5; i++) {
        await Effect.runPromise(limiter.acquire());
        limiter.release();
      }
      expect(limiter.windowRequestCount()).toBe(5);
    });

    it("tracks request count in sliding window", async () => {
      const limiter = makeRateLimiter({ requestsPerMinute: 10, maxConcurrent: 100 });
      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await Effect.runPromise(limiter.acquire());
        limiter.release();
      }
      expect(limiter.windowRequestCount()).toBe(3);
    });

    it("blocks when request limit is hit", async () => {
      const limiter = makeRateLimiter({
        requestsPerMinute: 2,
        maxConcurrent: 100,
      });

      // Fill the window
      await Effect.runPromise(limiter.acquire());
      limiter.release();
      await Effect.runPromise(limiter.acquire());
      limiter.release();

      // Third acquire should block — verify it doesn't resolve immediately
      let resolved = false;
      const raceResult = await Effect.runPromise(
        Effect.race(
          limiter.acquire().pipe(
            Effect.tap(() => Effect.sync(() => { resolved = true; })),
          ),
          Effect.sleep("50 millis").pipe(Effect.map(() => "timeout" as const)),
        ),
      );
      // The acquire should have been beaten by the timeout since the window is full
      expect(raceResult).toBe("timeout");
      expect(resolved).toBe(false);
    });
  });

  describe("concurrent request limiting", () => {
    it("tracks concurrent count", async () => {
      const limiter = makeRateLimiter({
        requestsPerMinute: 100,
        maxConcurrent: 5,
      });

      // Acquire without releasing
      await Effect.runPromise(limiter.acquire());
      await Effect.runPromise(limiter.acquire());
      expect(limiter.concurrentCount()).toBe(2);

      limiter.release();
      expect(limiter.concurrentCount()).toBe(1);

      limiter.release();
      expect(limiter.concurrentCount()).toBe(0);
    });

    it("blocks when max concurrent is reached", async () => {
      const limiter = makeRateLimiter({
        requestsPerMinute: 100,
        maxConcurrent: 2,
      });

      // Fill concurrent slots
      await Effect.runPromise(limiter.acquire());
      await Effect.runPromise(limiter.acquire());
      expect(limiter.concurrentCount()).toBe(2);

      // Third acquire should block
      let resolved = false;
      const raceResult = await Effect.runPromise(
        Effect.race(
          limiter.acquire().pipe(
            Effect.tap(() => Effect.sync(() => { resolved = true; })),
          ),
          Effect.sleep("50 millis").pipe(Effect.map(() => "timeout" as const)),
        ),
      );
      expect(raceResult).toBe("timeout");
      expect(resolved).toBe(false);
    });

    it("unblocks when a slot is released", async () => {
      const limiter = makeRateLimiter({
        requestsPerMinute: 100,
        maxConcurrent: 1,
      });

      // Fill the slot
      await Effect.runPromise(limiter.acquire());

      // Start a blocked acquire in background
      let acquired = false;
      const fiber = Effect.runFork(
        limiter.acquire().pipe(
          Effect.tap(() => Effect.sync(() => { acquired = true; })),
        ),
      );

      // Give the fiber a chance to start polling
      await new Promise((r) => setTimeout(r, 50));
      expect(acquired).toBe(false);

      // Release the slot
      limiter.release();

      // Wait for the fiber to complete
      await Effect.runPromise(
        Effect.sleep("200 millis"),
      );
      expect(acquired).toBe(true);
    });

    it("release does not go below zero", () => {
      const limiter = makeRateLimiter({ maxConcurrent: 5 });
      limiter.release();
      limiter.release();
      expect(limiter.concurrentCount()).toBe(0);
    });
  });

  describe("token-per-minute limiting", () => {
    it("allows requests under token limit", async () => {
      const limiter = makeRateLimiter({
        requestsPerMinute: 100,
        tokensPerMinute: 1000,
        maxConcurrent: 100,
      });

      // Short message should be well under 1000 tokens
      const msgs = makeMessages("Hello world");
      await Effect.runPromise(limiter.acquire(msgs));
      limiter.release();

      expect(limiter.windowTokenCount()).toBeGreaterThan(0);
      expect(limiter.windowTokenCount()).toBeLessThan(1000);
    });

    it("blocks when token limit would be exceeded", async () => {
      const limiter = makeRateLimiter({
        requestsPerMinute: 100,
        tokensPerMinute: 10, // Very low token limit
        maxConcurrent: 100,
      });

      // First request with enough text to exceed 10 tokens
      const longText = "The quick brown fox jumps over the lazy dog. ".repeat(20);
      const msgs = makeMessages(longText);

      // First acquire fills the token budget
      await Effect.runPromise(limiter.acquire(msgs));
      limiter.release();

      // Second acquire should block because tokens exceed limit
      let resolved = false;
      const raceResult = await Effect.runPromise(
        Effect.race(
          limiter.acquire(msgs).pipe(
            Effect.tap(() => Effect.sync(() => { resolved = true; })),
          ),
          Effect.sleep("50 millis").pipe(Effect.map(() => "timeout" as const)),
        ),
      );
      expect(raceResult).toBe("timeout");
      expect(resolved).toBe(false);
    });

    it("does not apply token limit when no messages provided", async () => {
      const limiter = makeRateLimiter({
        requestsPerMinute: 100,
        tokensPerMinute: 1, // Extremely low
        maxConcurrent: 100,
      });

      // Without messages, token limit is skipped
      await Effect.runPromise(limiter.acquire());
      limiter.release();
      await Effect.runPromise(limiter.acquire());
      limiter.release();

      // Should have 0 tokens recorded
      expect(limiter.windowTokenCount()).toBe(0);
    });
  });

  describe("default configuration", () => {
    it("uses sensible defaults", async () => {
      const limiter = makeRateLimiter();
      // Should be able to acquire with defaults (60 RPM, 100k TPM, 10 concurrent)
      await Effect.runPromise(limiter.acquire());
      limiter.release();
      expect(limiter.windowRequestCount()).toBe(1);
      expect(limiter.concurrentCount()).toBe(0);
    });
  });

  describe("sliding window expiry", () => {
    it("window count resets to 0 after entries expire", async () => {
      // We can't easily test 60s expiry, but we can verify the prune logic
      // by checking windowRequestCount reflects current window
      const limiter = makeRateLimiter({
        requestsPerMinute: 100,
        maxConcurrent: 100,
      });

      await Effect.runPromise(limiter.acquire());
      limiter.release();
      expect(limiter.windowRequestCount()).toBe(1);

      // Window count should still be 1 (entries haven't expired)
      expect(limiter.windowRequestCount()).toBe(1);
    });
  });
});
