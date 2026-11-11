import { describe, expect, it } from "bun:test";
import type { ChecklistGroupWire, ChecklistSnapshotWire, PersistedSubAgent } from "@reactive-agents/ui-core";
import { restoreSubAgents, subAgentCard, type ChatSubAgent } from "./sub-agent-view.js";
import type { ChatTurn } from "./stores/chat-store.js";

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({ id: 0, role: "assistant", content: "", tokensUsed: 0, ts: 0, ...over });
const agent = (over: Partial<ChatSubAgent> = {}, t: Partial<ChatTurn> = {}): ChatSubAgent => ({
  key: "t1",
  name: "btc-agent",
  depth: 1,
  status: "running",
  startedAt: 1000,
  turn: turn(t),
  ...over,
});
const call = (id: string, name: string, status: "running" | "done" | "failed", args?: unknown) => ({ id, name, iteration: 1, status, args });

const group = (key: string, label: string, rows: ChecklistGroupWire["rows"]): ChecklistGroupWire => ({
  key,
  label,
  rows,
  requirements: { done: 0, total: rows.length },
  advisory: { done: 0, total: 0 },
  activeAdvisoryIds: [],
  children: [],
});

describe("subAgentCard", () => {
  it("running card: one activity line from the running call, no raw JSON", () => {
    const card = subAgentCard(agent({}, { toolCalls: [call("c1", "web-search", "running", { query: "btc price", maxResults: 5 })] }), 6000);
    expect(card.activity).toBe("web-search “btc price”");
    expect(card.activity).not.toMatch(/[{}]/);
    expect(card.meta).toBe("1 tool · 5s");
  });

  it("goal status folds in from the parent checklist; a floor-only group shows none", () => {
    const parent: ChecklistSnapshotWire = {
      lastSeq: 3,
      root: {
        ...group("root", "root", []),
        children: [
          group("sub-agent:btc-agent#t1", "btc-agent", [
            { id: "answer", kind: "requirement", title: "produce a substantive answer that addresses the task", status: "done" },
            { id: "tool:web-search", kind: "requirement", title: "call the web-search tool", status: "done" },
          ]),
          group("sub-agent:eth#t2", "eth", [{ id: "answer", kind: "requirement", title: "floor", status: "done" }]),
        ],
      },
    };
    expect(subAgentCard(agent({ status: "done" }), 0, parent).goals).toBe("met");
    expect(subAgentCard(agent({ key: "t2", name: "eth", status: "done" }), 0, parent).goals).toBe("none");
  });

  it("an abstained child reads abstained with its reason", () => {
    const card = subAgentCard(agent({ status: "failed", ending: "abstained", reason: "No price source" }), 0);
    expect(card.state).toBe("abstained");
    expect(card.activity).toBe("No price source");
  });
});

describe("restoreSubAgents", () => {
  it("keys by the stable run key and carries strategy + ending", () => {
    const persisted: PersistedSubAgent[] = [
      {
        run: { key: "task-9", runId: "r9", name: "eth", depth: 1 } as PersistedSubAgent["run"],
        status: "failed",
        startedAt: 1,
        trace: { reasoningSteps: [], toolCalls: [], strategy: "reflexion", outcome: { ending: "abstained", abstention: { reason: "nope" } } },
      },
    ];
    const [a] = restoreSubAgents(persisted);
    expect(a).toMatchObject({ key: "task-9", strategy: "reflexion", ending: "abstained", reason: "nope" });
    expect(a!.turn.strategy).toBe("reflexion");
    // The drill-in transcript closes with the child's own ending, not "succeeded".
    expect(a!.turn.runFailed).toEqual({ ending: "abstained", abstention: { reason: "nope" } });
  });
});
