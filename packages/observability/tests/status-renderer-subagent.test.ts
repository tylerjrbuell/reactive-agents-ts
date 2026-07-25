import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { makeStatusRenderer } from "../src/logging/status-renderer";
import { makeObservableLogger } from "../src/logging/observable-logger";
import { PassThrough } from "node:stream";

function makeMockStream(): NodeJS.WriteStream {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream;
  stream.isTTY = true;
  return stream;
}

describe("StatusRenderer sub-agent collapse", () => {
  test("renders a collapsed one-line summary for a running sub-agent, freezes on completion", async () => {
    const out = makeMockStream();
    let written = "";
    out.on("data", (chunk) => { written += chunk.toString(); });

    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeObservableLogger({ live: false });
        const renderer = makeStatusRenderer(logger, out);
        yield* renderer.start();
        renderer.onAgentStarted({ taskId: "sub-1", agentId: "a2", parentAgentId: "a1", agentDisplayName: "bitcoin-price-finder" });
        renderer.onAgentCompleted({ taskId: "sub-1", agentId: "a2", success: true, totalTokens: 6467, durationMs: 8900 });
        renderer.stop();
      }),
    );

    expect(written).toContain("bitcoin-price-finder");
    expect(written).toContain("✓");
  });

  test("auto-expands and marks failure status on unsuccessful completion", async () => {
    const out = makeMockStream();
    let written = "";
    out.on("data", (chunk) => { written += chunk.toString(); });

    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeObservableLogger({ live: false });
        const renderer = makeStatusRenderer(logger, out);
        yield* renderer.start();
        renderer.onAgentStarted({ taskId: "sub-2", agentId: "a3", parentAgentId: "a1", agentDisplayName: "flaky-agent" });
        renderer.onAgentCompleted({ taskId: "sub-2", agentId: "a3", success: false, totalTokens: 42, durationMs: 100 });
        renderer.stop();
      }),
    );

    expect(written).toContain("flaky-agent");
    expect(written).toContain("✗");
  });
});
