import { describe, expect, test } from "bun:test";
import { conformanceCases } from "./conformance-cases.js";
import { runAdapterConformance, runConformanceCase } from "./run-adapter-conformance.js";
import { makeWebhookHarness } from "./webhook.harness.js";

runAdapterConformance("WebhookChannelAdapter", makeWebhookHarness(), {
  skip: {
    "a dropped connection reconnects without losing or repeating messages":
      "webhook has no long-lived connection; reconnect is covered by the withReconnect combinator tests",
  },
});

/**
 * RED-on-cut: each broken adapter must fail the shared case that guards the cut guarantee.
 * If a case stopped detecting its violation, the corresponding line here would go green.
 */
describe("conformance cases fail when a guarantee is cut", () => {
  test("idempotency: an adapter that emits a message id twice fails", async () => {
    await expect(
      runConformanceCase(
        conformanceCases["a platform message id is delivered at most once (idempotency)"]!,
        makeWebhookHarness("duplicate-inbound"),
      ),
    ).rejects.toThrow();
  });

  test("typed errors: an adapter that erases failure kinds fails", async () => {
    await expect(
      runConformanceCase(
        conformanceCases["platform failures become typed ChannelErrors with the right kind"]!,
        makeWebhookHarness("erase-error-kinds"),
      ),
    ).rejects.toThrow();
  });

  test("secrets: an adapter that puts the credential in an error fails", async () => {
    await expect(
      runConformanceCase(
        conformanceCases["credentials never appear in errors, receipts, state or envelopes"]!,
        makeWebhookHarness("leak-secret"),
      ),
    ).rejects.toThrow();
  });
});
