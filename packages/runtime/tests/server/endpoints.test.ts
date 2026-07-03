import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgentBuilder } from "../../src/builder.js";
import {
  createAgentEndpoint,
  createInboxEndpoint,
  createInteractionEndpoint,
  createRunAttachEndpoint,
  withRunEndSettle,
} from "../../src/server/endpoints.js";
import type { WireEvent } from "../../src/server/journal.js";

const sseEvents = async (
  res: Response,
): Promise<Array<{ seq?: number; e: { _tag: string } & Record<string, unknown> }>> => {
  const text = await res.text();
  const out: Array<{ seq?: number; e: { _tag: string } & Record<string, unknown> }> = [];
  let seq: number | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("id: ")) seq = Number(line.slice(4));
    if (line.startsWith("data: ")) {
      out.push({ seq, e: JSON.parse(line.slice(6)) });
      seq = undefined;
    }
  }
  return out;
};

const durableAgent = async (dir: string) =>
  new ReactiveAgentBuilder()
    .withName("endpoint-e2e")
    .withProvider("test")
    .withTestScenario([{ text: "hello from agent" }])
    .withDurableRuns({ dir })
    .build();

describe("endpoint helpers", () => {
  test("createAgentEndpoint streams journaled SSE with seq ids and CostDelta", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const handler = createAgentEndpoint(agent, { limits: false });
    const res = await handler(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
    );
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const events = await sseEvents(res);
    const tags = events.map((x) => x.e._tag);
    expect(tags).toContain("TextDelta");
    expect(tags).toContain("CostDelta");
    expect(tags.at(-1)).toBe("StreamCompleted");
    expect(events[0]!.seq).toBe(1);
    // seq strictly increasing
    const seqs = events.map((x) => x.seq).filter((s): s is number => s !== undefined);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  test("attach endpoint replays from cursor with RunAttached head", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const run = await createAgentEndpoint(agent, { limits: false })(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
    );
    const all = await sseEvents(run);
    const runId = (all.at(-1)!.e as { runId?: string }).runId;
    expect(runId).toBeDefined();

    const attach = createRunAttachEndpoint(agent);
    const res = await attach(new Request(`http://x/api/agent/${runId}?cursor=1`), { runId: runId! });
    const replayed = await sseEvents(res);
    expect(replayed[0]!.e._tag).toBe("RunAttached");
    expect((replayed[0]!.e as unknown as { resumeCursor: number }).resumeCursor).toBeGreaterThanOrEqual(1);
    // no event with seq <= cursor replayed
    const seqs = replayed.slice(1).map((x) => x.seq).filter((s): s is number => s !== undefined);
    expect(seqs.every((s) => s > 1)).toBe(true);
  });

  test("guards deny → single LimitExceeded event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const handler = createAgentEndpoint(agent, {
      limits: { anonymous: { runs: 0, window: "1h" } },
    });
    const res = await handler(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
    );
    const events = await sseEvents(res);
    expect(events.length).toBe(1);
    expect(events[0]!.e._tag).toBe("LimitExceeded");
    expect((events[0]!.e as unknown as { kind: string }).kind).toBe("anonymous");
  });

  test("inbox lists runs for resolved identity only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const asUser = (userId: string) => async () => ({ userId });
    // run one task as u1
    await (
      await createAgentEndpoint(agent, { limits: false, identify: asUser("u1") })(
        new Request("http://x/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "hi" }),
        }),
      )
    ).text();
    const inbox = createInboxEndpoint(agent, { identify: asUser("u1") });
    const res = await inbox(new Request("http://x/api/inbox"));
    const runs = (await res.json()) as Array<{ runId: string; status: string }>;
    expect(runs.length).toBe(1);

    const other = createInboxEndpoint(agent, { identify: asUser("u2") });
    const emptyRuns = (await (await other(new Request("http://x/api/inbox"))).json()) as unknown[];
    expect(emptyRuns.length).toBe(0);
  });

  test("interaction endpoint answers a pending interaction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await new ReactiveAgentBuilder()
      .withName("endpoint-interaction")
      .withProvider("test")
      .withReasoning()
      .withTestScenario([
        { toolCall: { name: "request_user_input", args: { kind: "confirmation", prompt: "Proceed?", schema: {} } } },
        { match: "yes", text: "Confirmed. Done." },
        { text: "fallback" },
      ])
      .withDurableRuns({ dir })
      .withUserInteraction()
      .build();

    const run = await createAgentEndpoint(agent, { limits: false })(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "do the thing" }),
      }),
    );
    const events = await sseEvents(run);
    const ir = events.find((x) => x.e._tag === "InteractionRequested");
    expect(ir).toBeDefined();
    const { runId, interactionId } = ir!.e as unknown as { runId: string; interactionId: string };

    const respond = createInteractionEndpoint(agent);
    const res = await respond(
      new Request("http://x/api/interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, interactionId, value: "yes" }),
      }),
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as { success: boolean; output: string };
    expect(result.success).toBe(true);
    expect(result.output).toContain("Confirmed");
  });

  test("malformed JSON body on the interaction endpoint returns 400, not a thrown 500", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const respond = createInteractionEndpoint(agent);
    const res = await respond(
      new Request("http://x/api/interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("withRunEndSettle (FIX1: guaranteed single onRunEnd release)", () => {
  const collect = async (gen: AsyncGenerator<WireEvent>): Promise<WireEvent[]> => {
    const out: WireEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  };

  test("settles once on StreamCompleted, forwarding the reported cost", async () => {
    async function* src(): AsyncGenerator<WireEvent> {
      yield { _tag: "TextDelta", text: "hi" };
      yield { _tag: "StreamCompleted", metadata: { cost: 0.02 } };
    }
    const calls: number[] = [];
    await collect(withRunEndSettle(src(), (cost) => calls.push(cost)));
    expect(calls).toEqual([0.02]);
  });

  test("settles exactly once even when the terminal tag is unrecognized (e.g. StreamCancelled) — the real leak bug", async () => {
    async function* src(): AsyncGenerator<WireEvent> {
      yield { _tag: "TextDelta", text: "hi" };
      yield { _tag: "StreamCancelled", reason: "aborted" };
    }
    const calls: number[] = [];
    await collect(withRunEndSettle(src(), (cost) => calls.push(cost)));
    expect(calls.length).toBe(1);
  });

  test("settles exactly once on plain exhaustion with no terminal tag at all", async () => {
    async function* src(): AsyncGenerator<WireEvent> {
      yield { _tag: "TextDelta", text: "hi" };
    }
    const calls: number[] = [];
    await collect(withRunEndSettle(src(), (cost) => calls.push(cost)));
    expect(calls.length).toBe(1);
  });

  test("settles exactly once on early consumer disconnect (.return() before any terminal event)", async () => {
    async function* infinite(): AsyncGenerator<WireEvent> {
      let i = 0;
      for (;;) {
        yield { _tag: "TextDelta", text: String(i++) };
      }
    }
    const calls: number[] = [];
    const wrapped = withRunEndSettle(infinite(), (cost) => calls.push(cost));
    await wrapped.next();
    await wrapped.return(undefined);
    expect(calls.length).toBe(1);
  });

  test("a thrown error still settles exactly once before propagating", async () => {
    async function* src(): AsyncGenerator<WireEvent> {
      yield { _tag: "TextDelta", text: "hi" };
      throw new Error("boom");
    }
    const calls: number[] = [];
    await expect(collect(withRunEndSettle(src(), (cost) => calls.push(cost)))).rejects.toThrow("boom");
    expect(calls.length).toBe(1);
  });
});

describe("FIX1 endpoint-level regression: concurrency slot release on disconnect", () => {
  test("consuming the SSE only partially then breaking still releases the concurrency slot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await new ReactiveAgentBuilder()
      .withName("endpoint-e2e-fix1")
      .withProvider("test")
      .withTestScenario([{ text: "hello from agent, a longer response so there is more than one delta chunk" }])
      .withDurableRuns({ dir })
      .build();
    const handler = createAgentEndpoint(agent, { limits: { maxConcurrentRunsPerUser: 1 } });
    const makeReq = () =>
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      });

    const res1 = await handler(makeReq());
    const reader = res1.body!.getReader();
    await reader.read(); // consume only the first chunk — simulate a client that stops reading
    await reader.cancel(); // simulate tab-close / abandoned consumer

    // Let the (still-running-in-background) stream drain so onRunEnd fires.
    await new Promise((r) => setTimeout(r, 100));

    const res2 = await handler(makeReq());
    const events2 = await sseEvents(res2);
    expect(events2.map((x) => x.e._tag)).not.toContain("LimitExceeded");
  });
});
