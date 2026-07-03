import { describe, expect, test } from "bun:test";
import { connectRunStream } from "../src/stream/connect.js";
import {
  fixtureToSSE,
  mockAgentEndpoint,
  recordRunFixture,
  type RunFixture,
} from "../src/testing/fixtures.js";
import type { SeqStamped, UiStreamEvent } from "../src/protocol/events.js";

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "4", seq: 1 },
    { _tag: "StreamCompleted", output: "4", metadata: { cost: 0.001, tokensUsed: 10 }, runId: "r1", seq: 2 },
  ],
};

describe("fixtures", () => {
  test("mockAgentEndpoint replays fixture through connectRunStream", async () => {
    const handler = mockAgentEndpoint(FIXTURE);
    const fetchImpl: typeof fetch = async (input, init) =>
      handler(new Request(new URL(String(input), "http://localhost").toString(), init as RequestInit));
    const got: UiStreamEvent[] = [];
    for await (const e of connectRunStream({ endpoint: "http://localhost/api/agent", body: { prompt: "2+2" }, fetchImpl })) {
      got.push(e);
    }
    expect(got).toEqual(FIXTURE.events as UiStreamEvent[]);
  });

  test("recordRunFixture captures a stream verbatim", async () => {
    async function* src(): AsyncGenerator<SeqStamped<UiStreamEvent>> {
      yield { _tag: "TextDelta", text: "x", seq: 1 };
      yield { _tag: "StreamCompleted", output: "x", metadata: {}, seq: 2 };
    }
    const fixture = await recordRunFixture(src());
    expect(fixture.protocolVersion).toBe(1);
    expect(fixture.events.length).toBe(2);
  });

  test("record → replay round-trip is lossless", async () => {
    const handler = mockAgentEndpoint(FIXTURE);
    const fetchImpl: typeof fetch = async (input, init) =>
      handler(new Request(new URL(String(input), "http://localhost").toString(), init as RequestInit));
    const rerecorded = await recordRunFixture(
      connectRunStream({ endpoint: "http://localhost/x", body: {}, fetchImpl }),
    );
    expect(rerecorded.events).toEqual(FIXTURE.events);
  });

  test("fixtureToSSE emits id: lines for seq", async () => {
    const text = await fixtureToSSE(FIXTURE).text();
    expect(text).toContain("id: 1\n");
    expect(text).toContain('data: {"_tag":"TextDelta"');
  });
});
