/**
 * A strategy's live phases (`StepEvent`s) fold into the turn's `strategyRun` as they stream,
 * and the turn ending settles them.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { strategyStatusOf } from "@reactive-agents/ui-core";
import { streamAssistantTurn } from "./chat-stream.js";
import type { ChatTurn } from "./chat-store.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const sse = (e: object) => `data: ${JSON.stringify(e)}\n\n`;
const stepEv = (pass: string, extra: object = {}) => sse({ _tag: "StepEvent", step: { kind: "strategy-step", pass, ...extra } });

async function run(lines: string[]): Promise<{ final: ChatTurn; snapshots: ChatTurn[] }> {
  const enc = new TextEncoder();
  globalThis.fetch = Object.assign(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            for (const l of lines) c.enqueue(enc.encode(l));
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    { preconnect: (): void => {} },
  );
  let turns: ChatTurn[] = [{ id: 1, role: "assistant", content: "", tokensUsed: 0, ts: 1000, streaming: true }];
  const snapshots: ChatTurn[] = [];
  await streamAssistantTurn({
    endpoint: "http://x/stream",
    body: {},
    signal: new AbortController().signal,
    assistantTurnId: 1,
    apply: (f) => {
      turns = f(turns);
      snapshots.push(turns[0]!);
    },
  });
  return { final: turns[0]!, snapshots };
}

describe("strategy steps on the chat stream", () => {
  it("fold into the turn live: the status line names the phase while the run goes", async () => {
    const { snapshots } = await run([stepEv("reflexion:generate"), stepEv("reflexion:critique-1")]);
    const live = snapshots.filter((t) => t.strategyRun?.current && !t.strategyRun.ended).at(-1)!;
    expect(strategyStatusOf(live.strategyRun!)).toBe("Critiquing 1");
    expect(live.strategyRun!.rows.map((r) => r.key)).toEqual(["generate", "critique-1"]);
  });

  it("the turn ending settles every phase and clears the status line", async () => {
    const { final } = await run([
      stepEv("tree-of-thought:explore", { node: { id: "a", depth: 1, score: 0.8 } }),
      sse({ _tag: "StreamCompleted", output: "done", metadata: { tokensUsed: 1, cost: 0, stepsCount: 1, duration: 1 } }),
    ]);
    expect(final.strategyRun?.ended).toBe(true);
    expect(final.strategyRun?.rows.every((r) => r.status === "done")).toBe(true);
    expect(final.strategyRun?.nodes).toHaveLength(1);
  });

  it("a failed completion (a strategy refusal: success false + error) settles the phases and shows the reason", async () => {
    const cause = "Strategy execution failed (code-action): code-action cannot honor .withApprovalPolicy";
    const { final } = await run([
      stepEv("reflexion:generate"),
      sse({ _tag: "StreamCompleted", output: "", metadata: {}, success: false, terminatedBy: "llm_error", error: cause }),
    ]);
    expect(final.strategyRun?.ended).toBe(true);
    expect(final.streaming).toBeFalsy();
    expect(final.runFailed?.error).toContain("code-action cannot honor .withApprovalPolicy");
  });

  it("a turn with no steps leaves strategyRun absent, and a malformed step is ignored", async () => {
    const { final } = await run([sse({ _tag: "StepEvent", step: { nonsense: true } }), sse({ _tag: "StreamCompleted", output: "x", metadata: {} })]);
    expect(final.strategyRun).toBeUndefined();
  });
});
