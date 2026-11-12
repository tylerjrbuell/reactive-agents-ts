import { describe, expect, test } from "bun:test";
import { conformanceCases } from "./conformance-cases.js";
import { runAdapterConformance, runConformanceCase } from "./run-adapter-conformance.js";
import { makeTelegramHarness } from "./telegram.harness.js";

runAdapterConformance("TelegramChannelAdapter", makeTelegramHarness());

/** RED-on-cut: each broken adapter must fail the shared case that guards the cut guarantee. */
describe("telegram conformance cases fail when a guarantee is cut", () => {
  test("echo suppression: an adapter that never flags echoes fails", async () => {
    await expect(
      runConformanceCase(
        conformanceCases["echoes of the bot's own messages are never presented as user input"]!,
        makeTelegramHarness("no-echo-detection"),
      ),
    ).rejects.toThrow();
  });

  test("typed errors: an adapter that erases failure kinds fails", async () => {
    await expect(
      runConformanceCase(
        conformanceCases["platform failures become typed ChannelErrors with the right kind"]!,
        makeTelegramHarness("erase-error-kinds"),
      ),
    ).rejects.toThrow();
  });

  test("idempotency: an adapter that emits a message id twice fails", async () => {
    await expect(
      runConformanceCase(
        conformanceCases["a platform message id is delivered at most once (idempotency)"]!,
        makeTelegramHarness("duplicate-inbound"),
      ),
    ).rejects.toThrow();
  });
});
