import { describe, expect, it } from "bun:test";
import { subAgentView, type ChatSubAgent } from "./sub-agent-view.js";
import type { ChatTurn } from "./stores/chat-store.js";

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({ id: 0, role: "assistant", content: "", tokensUsed: 0, ts: 0, ...over });
const agent = (over: Partial<ChatSubAgent> = {}, t: Partial<ChatTurn> = {}): ChatSubAgent => ({
  key: "a1",
  name: "alpha",
  depth: 1,
  status: "running",
  startedAt: 1000,
  turn: turn(t),
  ...over,
});
const call = (id: string, name: string, iteration: number) => ({ id, name, iteration, status: "done" as const, args: { q: id } });

describe("subAgentView", () => {
  it("running: preview is the last 3 activity lines", () => {
    const v = subAgentView(
      agent({}, {
        reasoningSteps: [{ iteration: 1, maxIterations: 0, thought: "plan the search" }],
        toolCalls: [call("c1", "web-search", 1), call("c2", "file-read", 2), call("c3", "file-write", 2)],
      }),
      4000,
    );
    expect(v.previewLines).toHaveLength(3);
    expect(v.previewLines[2]).toContain("file-write");
    expect(v.previewLines[0]).toContain("web-search");
  });

  it("done: preview switches to the first output line", () => {
    const v = subAgentView(agent({ status: "done", output: "\nFound 3 results\nmore detail" }, { toolCalls: [call("c1", "x", 1)] }), 4000);
    expect(v.previewLines).toEqual(["Found 3 results"]);
  });

  it("counts and labels", () => {
    const v = subAgentView(
      agent({ status: "done", startedAt: 1000, endedAt: 13000, costUsd: 0.004 }, { toolCalls: [call("1", "a", 1), call("2", "b", 1), call("3", "c", 1)] }),
      99999,
    );
    expect(v.title).toBe("alpha");
    expect(v.toolCount).toBe(3);
    expect(v.elapsedLabel).toBe("12s");
    expect(v.costLabel).toBe("$0.004");
    expect(v.summary).toBe("3 tools · 12s · $0.004");
  });

  it("singular tool, running elapsed from now, no cost yet", () => {
    const v = subAgentView(agent({}, { toolCalls: [call("1", "a", 1)] }), 6000);
    expect(v.summary).toBe("1 tool · 5s");
    expect(v.status).toBe("running");
  });

  it("children pass through in order", () => {
    const kid = agent({ key: "g1", name: "grand", depth: 2 });
    const v = subAgentView(agent({}, { subAgents: [kid] }), 0);
    expect(v.children.map((c) => c.name)).toEqual(["grand"]);
  });
});
