// Run: bun test packages/observability/tests/structured-logger-redaction.test.ts --timeout 15000
//
// S0.3 Task 3 — verify the StructuredLogger applies redactors to log
// messages and string metadata before persisting / forwarding to sinks.
// Without this wiring, a user logging `logger.info("token: ghp_...")`
// would write the raw secret to the logsRef and live writer; redacting
// at the application layer is too late (developers forget).

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeStructuredLogger } from "../src/logging/structured-logger.js";
import { defaultRedactors } from "../src/redaction/index.js";
import type { Redactor } from "../src/redaction/index.js";

describe("StructuredLogger redaction (S0.3 Task 3)", () => {
  const customRedactor: Redactor = {
    name: "internal-tag",
    pattern: /internal-\w+/g,
    replacement: "[redacted-internal]",
  };

  it("redacts secrets from log messages before they reach storage", async () => {
    const captured: string[] = [];
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger({
          redactors: defaultRedactors,
          liveWriter: (entry) => captured.push(entry.message),
        });
        yield* logger.info("found token ghp_abc123def456ghi789jkl012mno345pqr678stu in payload");
        return yield* logger.getLogs();
      }),
    );
    expect(logs.length).toBe(1);
    expect(logs[0]!.message).toContain("[redacted-github-token]");
    expect(logs[0]!.message).not.toContain("ghp_abc123");
    expect(captured[0]).toContain("[redacted-github-token]");
    expect(captured[0]).not.toContain("ghp_abc123");
  }, 15000);

  it("preserves messages that contain no secrets unchanged", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger({ redactors: defaultRedactors });
        yield* logger.info("agent started successfully");
        return yield* logger.getLogs();
      }),
    );
    expect(logs[0]!.message).toBe("agent started successfully");
  }, 15000);

  it("composes user-supplied redactors with the configured set", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger({
          redactors: [...defaultRedactors, customRedactor],
        });
        yield* logger.info("see internal-deadbeef and ghp_abc123def456ghi789jkl012mno345pqr678stu");
        return yield* logger.getLogs();
      }),
    );
    expect(logs[0]!.message).toContain("[redacted-internal]");
    expect(logs[0]!.message).toContain("[redacted-github-token]");
  }, 15000);

  it("does not redact when no redactors are configured (backward compat)", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger();
        yield* logger.info("ghp_abc123def456ghi789jkl012mno345pqr678stu");
        return yield* logger.getLogs();
      }),
    );
    expect(logs[0]!.message).toBe("ghp_abc123def456ghi789jkl012mno345pqr678stu");
  }, 15000);

  it("redacts string-valued metadata fields", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger({ redactors: defaultRedactors });
        yield* logger.info("login attempt", {
          token: "ghp_abc123def456ghi789jkl012mno345pqr678stu",
          requestId: "req-12345",
        });
        return yield* logger.getLogs();
      }),
    );
    const meta = logs[0]!.metadata as Record<string, unknown>;
    expect(meta.token).toBe("[redacted-github-token]");
    expect(meta.requestId).toBe("req-12345");
  }, 15000);

  it("redacts even on logger.error which carries an Error object", async () => {
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger({ redactors: defaultRedactors });
        yield* logger.error(
          "auth failed for token sk-abcdefghijklmnopqrstuvwxyz1234567890abcdefghijkl",
          new Error("HTTP 401"),
        );
        return yield* logger.getLogs();
      }),
    );
    expect(logs[0]!.message).toContain("[redacted-openai-key]");
    expect(logs[0]!.message).not.toContain("sk-abcdef");
  }, 15000);
});
