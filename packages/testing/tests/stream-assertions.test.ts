import { describe, test, expect } from "bun:test";
import { expectStream } from "../src/assertions/stream";

describe("expectStream", () => {
  test("toEmitTextDeltas() passes for generator with TextDelta events", async () => {
    async function* fakeStream() {
      yield { _tag: "TextDelta" as const, text: "hello" };
      yield { _tag: "TextDelta" as const, text: " world" };
      yield { _tag: "StreamCompleted" as const };
    }
    await expectStream(fakeStream()).toEmitTextDeltas();
  });

  test("toEmitTextDeltas() fails for generator with no TextDelta events", async () => {
    async function* fakeStream() {
      yield { _tag: "StreamCompleted" as const };
    }
    await expect(expectStream(fakeStream()).toEmitTextDeltas()).rejects.toThrow();
  });

  test("toComplete() passes when stream completes within timeout", async () => {
    async function* fakeStream() {
      yield { _tag: "TextDelta" as const, text: "hi" };
      yield { _tag: "StreamCompleted" as const };
    }
    await expectStream(fakeStream()).toComplete({ within: 5000 });
  });

  test("toComplete() fails when stream does not complete within timeout", async () => {
    async function* slowStream() {
      await new Promise((r) => setTimeout(r, 200));
      yield { _tag: "StreamCompleted" as const };
    }
    await expect(expectStream(slowStream()).toComplete({ within: 50 })).rejects.toThrow();
  });

  test("toEmitEvents() checks for specific event tags", async () => {
    async function* fakeStream() {
      yield { _tag: "TextDelta" as const, text: "hi" };
      yield { _tag: "IterationProgress" as const, iteration: 1 };
      yield { _tag: "StreamCompleted" as const };
    }
    await expectStream(fakeStream()).toEmitEvents(["TextDelta", "IterationProgress"]);
  });
});
