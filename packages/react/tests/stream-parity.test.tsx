// Run: bun test packages/react/tests/stream-parity.test.tsx --timeout 15000
//
// #188 divergence-class tripwire — the three UI bindings (react / svelte /
// vue) must stay behaviorally equivalent over an identical wire fixture.
// Wave 1 shipped a provider-level `thinking_delta` StreamEvent that is
// deliberately NOT mirrored onto the UI wire protocol (recorded decision in
// packages/ui-core/src/protocol/events.ts); the future wire field that WILL
// cross the SSE boundary is exactly the ad-hoc-addition class that made the
// three bindings drift apart in #188. This test pins the contract:
//
//   1. identical visible-text accumulation (TextDelta),
//   2. identical terminal state (StreamCompleted → completed + output),
//   3. an UNKNOWN forward-compat tag (simulating a future ThinkingDelta wire
//      tag) must be tolerated by every binding: no crash, no leak of its
//      payload into visible text, event still accumulated/observable.
//
// If a wire field is ever added, extend the fixture here — a binding that
// forgets to handle the change fails this file, not a user's dashboard.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  initialRunState,
  type FetchLike,
  type RunState,
  type SeqStamped,
  type UiStreamEvent,
} from "@reactive-agents/ui-core";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import { withHappyDom } from "./happy-dom.js";
import { useRun } from "../src/hooks/use-run.js";
// Cross-binding imports resolve through the bun workspace root (all workspace
// packages are symlinked there); these are test-only — no package.json dep is
// added to @reactive-agents/react for them.
import { createRun as createSvelteRun } from "@reactive-agents/svelte";
import { useAgentStream as useVueAgentStream } from "@reactive-agents/vue";

withHappyDom();

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// A thinking-flavored tag NOT in the v1 union — the exact shape a future
// wire-side thinking mirror would take. All bindings must ignore it safely.
const FUTURE_TAG = {
  _tag: "ThinkingDelta",
  thinking: "SECRET-INTERNAL-REASONING",
  seq: 2,
} as unknown as SeqStamped<UiStreamEvent>;

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "The ", seq: 1 },
    FUTURE_TAG,
    { _tag: "TextDelta", text: "answer is 4.", seq: 3 },
    {
      _tag: "StreamCompleted",
      output: "The answer is 4.",
      metadata: {},
      seq: 4,
    },
  ],
};

const EXPECTED_TEXT = "The answer is 4.";
const EXPECTED_EVENT_COUNT = FIXTURE.events.length;

const fixtureFetch = (): FetchLike => {
  const handler = mockAgentEndpoint(FIXTURE);
  return async (input, init) =>
    handler(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};

interface BindingOutcome {
  readonly text: string;
  readonly output: string | null;
  readonly status: string;
  readonly eventCount: number;
}

const poll = async (check: () => BindingOutcome | null): Promise<BindingOutcome> => {
  for (let i = 0; i < 250; i++) {
    const done = check();
    if (done) return done;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("parity fixture stream did not settle in time");
};

const expectParityContract = (binding: string, o: BindingOutcome) => {
  expect(o.status, binding).toBe("completed");
  expect(o.text, binding).toBe(EXPECTED_TEXT);
  expect(o.output, binding).toBe(EXPECTED_TEXT);
  expect(o.eventCount, binding).toBe(EXPECTED_EVENT_COUNT);
  // The unknown tag's payload must never leak into visible text.
  expect(o.text, binding).not.toContain("SECRET-INTERNAL-REASONING");
};

describe("three-binding wire parity (#188 tripwire)", () => {
  test("react useRun handles the shared fixture incl. an unknown forward-compat tag", async () => {
    const { result } = renderHook(() =>
      useRun({ endpoint: "/api/agent", fetchImpl: fixtureFetch() }),
    );
    act(() => result.current.run("2+2"));
    await waitFor(() => expect(result.current.state.status).toBe("completed"));
    expectParityContract("react", {
      text: result.current.state.text,
      output: result.current.state.output ?? null,
      status: result.current.state.status,
      eventCount: result.current.state.events.length,
    });
  }, 15000);

  test("svelte createRun handles the shared fixture incl. an unknown forward-compat tag", async () => {
    const store = createSvelteRun({ endpoint: "/api/agent", fetchImpl: fixtureFetch() });
    let snap: RunState = initialRunState();
    const unsub = store.subscribe((s) => {
      snap = s;
    });
    store.run("2+2");
    const o = await poll(() =>
      snap.status === "completed"
        ? {
            text: snap.text,
            output: snap.output ?? null,
            status: snap.status,
            eventCount: snap.events.length,
          }
        : null,
    );
    unsub();
    expectParityContract("svelte", o);
  }, 15000);

  test("vue useAgentStream handles the shared fixture incl. an unknown forward-compat tag", async () => {
    const handler = mockAgentEndpoint(FIXTURE);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(new URL(String(input), "http://ra.test").toString(), init))) as typeof fetch;

    const stream = useVueAgentStream("/api/agent");
    stream.run("2+2");
    const o = await poll(() =>
      stream.status.value === "completed"
        ? {
            text: stream.text.value,
            output: stream.output.value,
            status: stream.status.value,
            eventCount: stream.events.value.length,
          }
        : null,
    );
    expectParityContract("vue", o);
  }, 15000);
});
