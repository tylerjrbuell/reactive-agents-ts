import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import crypto from "crypto";
import { createGitHubAdapter } from "../../src/adapters/github-adapter.js";
import type { WebhookRequest } from "../../src/adapters/webhook-adapter.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeSignature = (body: string, secret: string): string => {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  return `sha256=${hmac.digest("hex")}`;
};

const makeGitHubRequest = (
  payload: Record<string, unknown>,
  event: string,
  secret?: string,
): WebhookRequest => {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "x-github-event": event,
    "x-github-delivery": "test-delivery-123",
    "content-type": "application/json",
  };
  if (secret) {
    headers["x-hub-signature-256"] = makeSignature(body, secret);
  }
  return { body, headers };
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GitHub Webhook Adapter", () => {
  const adapter = createGitHubAdapter();

  test("validates correct HMAC-SHA256 signature", async () => {
    const secret = "my-webhook-secret";
    const req = makeGitHubRequest(
      { action: "opened", pull_request: { number: 42 } },
      "pull_request",
      secret,
    );

    const valid = await Effect.runPromise(
      adapter.validateSignature(req, secret),
    );
    expect(valid).toBe(true);
  });

  test("rejects invalid signature", async () => {
    const body = JSON.stringify({ action: "opened" });
    const req: WebhookRequest = {
      body,
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
    };

    const valid = await Effect.runPromise(
      adapter.validateSignature(req, "real-secret"),
    );
    expect(valid).toBe(false);
  });

  test("transforms GitHub PR event to GatewayEvent with correct metadata", async () => {
    const payload = { action: "opened", pull_request: { number: 42, title: "feat: new thing" } };
    const req = makeGitHubRequest(payload, "pull_request");

    const event = await Effect.runPromise(adapter.transform(req));

    expect(event.source).toBe("webhook");
    expect(event.payload).toEqual(payload);
    expect(event.priority).toBe("normal");
    expect(event.metadata["adapter"]).toBe("github");
    expect(event.metadata["githubEvent"]).toBe("pull_request");
    expect(event.metadata["category"]).toBe("pull_request.opened");
    expect(event.metadata["action"]).toBe("opened");
    expect(event.metadata["deliveryId"]).toBe("test-delivery-123");
    expect(event.id).toMatch(/^gh-/);
  });

  test("classifies event category from metadata", () => {
    const event = {
      id: "gh-1",
      source: "webhook" as const,
      timestamp: new Date(),
      payload: {},
      priority: "normal" as const,
      metadata: {
        adapter: "github",
        githubEvent: "issues",
        action: "closed",
        category: "issues.closed",
      },
    };

    expect(adapter.classify(event)).toBe("issues.closed");
  });
});
