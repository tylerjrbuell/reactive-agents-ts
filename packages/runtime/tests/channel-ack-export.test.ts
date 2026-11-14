import { describe, test, expect } from "bun:test";
import { toChannelHandle, makeAcknowledge, drainWithNarration } from "../src/index.js";
import type { ChannelAgentHandle, StreamedTurn } from "../src/index.js";

describe("channel ack helpers public export", () => {
  test("exported from the package index as functions", () => {
    expect(typeof toChannelHandle).toBe("function");
    expect(typeof makeAcknowledge).toBe("function");
    expect(typeof drainWithNarration).toBe("function");
  });

  test("makeAcknowledge wraps a completion and trims", async () => {
    const complete: NonNullable<ChannelAgentHandle["complete"]> = async () => ({ message: "  on it  " }) as never;
    const ack = makeAcknowledge(complete);
    const { Effect } = await import("effect");
    const out = await Effect.runPromise(ack({ text: "hi" } as never));
    expect(out).toEqual({ text: "on it" });
  });

  test("drainWithNarration returns StreamedTurn", async () => {
    async function* gen() {
      yield { _tag: "StreamCompleted", output: "done", metadata: { tokensUsed: 3, cost: 0 } } as never;
    }
    const r: StreamedTurn = await drainWithNarration(gen(), () => {});
    expect(r.text).toBe("done");
  });
});
