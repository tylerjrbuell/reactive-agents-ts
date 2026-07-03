import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectRunStream,
  initialRunState,
  reduceRunState,
  type FetchLike,
  type RunState,
} from "@reactive-agents/ui-core";
import { recordRunFixture } from "@reactive-agents/ui-core/testing";
import { ReactiveAgentBuilder } from "../../src/builder.js";
import { createAgentEndpoint, createRunAttachEndpoint } from "../../src/server/endpoints.js";

describe("client/server protocol round-trip", () => {
  test("ui-core state machine fully consumes a real endpoint stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-rt-"));
    const agent = await new ReactiveAgentBuilder()
      .withName("roundtrip")
      .withProvider("test")
      .withTestScenario([{ text: "final answer text" }])
      .withDurableRuns({ dir })
      .build();
    const handler = createAgentEndpoint(agent, { limits: false });
    // Mock fetch: like a browser, resolve the relative endpoint against an origin
    // (the raw Request constructor rejects relative URLs).
    const fetchImpl: FetchLike = async (input, init) =>
      handler(new Request(new URL(String(input), "http://ra.test"), init as RequestInit));

    let state: RunState = initialRunState();
    for await (const e of connectRunStream({ endpoint: "/api/agent", body: { prompt: "go" }, fetchImpl })) {
      state = reduceRunState(state, e);
    }
    expect(state.status).toBe("completed");
    expect(state.output).toBe("final answer text");
    expect(state.runId).toBeDefined();
    expect(state.lastSeq).toBeGreaterThan(0);
    expect(state.cost).toBeDefined();
  });

  test("attach replay reduces to the same terminal state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-rt-"));
    const agent = await new ReactiveAgentBuilder()
      .withName("roundtrip2")
      .withProvider("test")
      .withTestScenario([{ text: "replayed answer" }])
      .withDurableRuns({ dir })
      .build();
    const run = createAgentEndpoint(agent, { limits: false });
    const attach = createRunAttachEndpoint(agent);

    // full run first
    let live: RunState = initialRunState();
    const liveFetch: FetchLike = async (i, init) =>
      run(new Request(new URL(String(i), "http://ra.test"), init as RequestInit));
    for await (const e of connectRunStream({ endpoint: "/a", body: { prompt: "x" }, fetchImpl: liveFetch })) {
      live = reduceRunState(live, e);
    }

    // then replay from scratch through the attach endpoint
    const attachFetch: FetchLike = async (input) => {
      const url = new URL(String(input), "http://x");
      const runId = url.pathname.split("/").at(-1)!;
      return attach(new Request(url), { runId: decodeURIComponent(runId) });
    };
    let replayed: RunState = initialRunState();
    for await (const e of connectRunStream({
      endpoint: "/a",
      attach: { runId: live.runId!, cursor: 0 },
      fetchImpl: attachFetch,
    })) {
      replayed = reduceRunState(replayed, e);
    }
    expect(replayed.status).toBe("completed");
    expect(replayed.output).toBe(live.output);
  });

  test("fixture recorded from real endpoint replays deterministically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-rt-"));
    const agent = await new ReactiveAgentBuilder()
      .withName("roundtrip3")
      .withProvider("test")
      .withTestScenario([{ text: "fixture me" }])
      .withDurableRuns({ dir })
      .build();
    const handler = createAgentEndpoint(agent, { limits: false });
    const fetchImpl: FetchLike = async (i, init) =>
      handler(new Request(new URL(String(i), "http://ra.test"), init as RequestInit));
    const fixture = await recordRunFixture(
      connectRunStream({ endpoint: "/a", body: { prompt: "x" }, fetchImpl }),
    );
    expect(fixture.events.at(-1)?._tag).toBe("StreamCompleted");
    expect(fixture.events.some((e) => e._tag === "CostDelta")).toBe(true);
  });
});
