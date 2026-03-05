import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import crypto from "crypto";
import { WebhookService, WebhookServiceLive } from "../../src/services/webhook-service.js";
import { createGitHubAdapter } from "../../src/adapters/github-adapter.js";
import type { WebhookRequest } from "../../src/adapters/webhook-adapter.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeGitHubRequest = (
  payload: Record<string, unknown>,
  event: string,
  secret?: string,
): WebhookRequest => {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "x-github-event": event,
    "content-type": "application/json",
  };
  if (secret) {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(body);
    headers["x-hub-signature-256"] = `sha256=${hmac.digest("hex")}`;
  }
  return { body, headers };
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WebhookService", () => {
  test("routes request to registered adapter", async () => {
    const req = makeGitHubRequest(
      { action: "opened", pull_request: { number: 1 } },
      "pull_request",
    );

    const event = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* WebhookService;
        yield* svc.registerAdapter("/github", createGitHubAdapter());
        return yield* svc.handleRequest("/github", req);
      }).pipe(Effect.provide(WebhookServiceLive())),
    );

    expect(event.source).toBe("webhook");
    expect(event.metadata["adapter"]).toBe("github");
    expect(event.metadata["githubEvent"]).toBe("pull_request");
    expect(event.metadata["category"]).toBe("pull_request.opened");
  });

  test("returns error for unknown path", async () => {
    const req: WebhookRequest = {
      body: "{}",
      headers: {},
    };

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* WebhookService;
        return yield* svc.handleRequest("/nonexistent", req);
      }).pipe(Effect.provide(WebhookServiceLive())),
    );

    expect(result._tag).toBe("Failure");
    // Extract the error message from the Exit
    const json = JSON.stringify(result);
    expect(json).toContain("No adapter registered for path");
    expect(json).toContain("404");
  });

  test("rejects invalid signature when secret configured", async () => {
    const body = JSON.stringify({ action: "push" });
    const req: WebhookRequest = {
      body,
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=invalid",
      },
    };

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* WebhookService;
        yield* svc.registerAdapter(
          "/github",
          createGitHubAdapter(),
          "my-secret",
        );
        return yield* svc.handleRequest("/github", req);
      }).pipe(Effect.provide(WebhookServiceLive())),
    );

    expect(result._tag).toBe("Failure");
    const json = JSON.stringify(result);
    expect(json).toContain("Invalid webhook signature");
    expect(json).toContain("401");
  });
});
