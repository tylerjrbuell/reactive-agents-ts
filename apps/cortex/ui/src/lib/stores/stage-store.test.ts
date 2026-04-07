import { describe, it, expect } from "bun:test";
import { get } from "svelte/store";
import { createStageStore } from "./stage-store.js";
import type { AgentNode } from "./agent-store.js";
import { defaultConfig } from "../types/agent-config.js";

const baseAgent = (over: Partial<AgentNode> = {}): AgentNode => ({
  agentId: "a1",
  runId: "r1",
  name: "a1",
  state: "running",
  entropy: 0,
  loopIteration: 0,
  reasoningSteps: 0,
  maxIterations: 0,
  tokensUsed: 0,
  cost: 0,
  connectedAt: 0,
  lastEventAt: 0,
  ...over,
});

describe("createStageStore", () => {
  it("handleAgentConnected navigates once when first agent and count is 1", () => {
    const paths: string[] = [];
    const store = createStageStore({
      navigate: (p) => {
        paths.push(p);
      },
    });

    store.handleAgentConnected(baseAgent(), 1);
    expect(paths).toEqual(["/run/r1"]);
    expect(get(store).firstConnectHandled).toBe(true);

    store.handleAgentConnected(baseAgent({ runId: "r2", agentId: "a2" }), 2);
    expect(paths).toEqual(["/run/r1"]);
  });

  it("submitPrompt records error on 501", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: "not implemented" }), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      });

    const store = createStageStore({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.submitPrompt("hello");

    expect(get(store).lastSubmitError).toContain("not implemented");
    expect(get(store).submitting).toBe(false);
  });

  it("submitPrompt navigates on 200 with runId", async () => {
    const paths: string[] = [];
    const fetchImpl = async () =>
      new Response(JSON.stringify({ runId: "rx", agentId: "ax" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const store = createStageStore({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      navigate: (p) => { paths.push(p); },
    });
    await store.submitPrompt("go");

    expect(paths).toEqual(["/run/rx"]);
    expect(get(store).lastSubmitError).toBeNull();
  });

  it("submitPrompt forwards taskContext in POST body when cfg is passed", async () => {
    let posted: string | undefined;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      posted = init?.body as string;
      return new Response(JSON.stringify({ runId: "r-tc" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const store = createStageStore({ fetchImpl: fetchImpl as typeof fetch });
    const cfg = {
      ...defaultConfig(),
      taskContext: { project: "beacon-test" },
    };
    await store.submitPrompt("hello", cfg);

    const body = JSON.parse(posted!) as { prompt: string; taskContext?: Record<string, string> };
    expect(body.taskContext).toEqual({ project: "beacon-test" });
    expect(body.prompt).toBe("hello");
  });

  it("submitPrompt polls GET /api/runs when POST returns agentId only", async () => {
    const paths: string[] = [];
    let postDone = false;
    const startedAt = Date.now();
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postDone = true;
        return new Response(JSON.stringify({ agentId: "ag-poll" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      expect(postDone).toBe(true);
      const runs = [
        {
          runId: "run-resolved",
          agentId: "ag-poll",
          startedAt,
        },
      ];
      return new Response(JSON.stringify(runs), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const store = createStageStore({
      fetchImpl: fetchImpl as typeof fetch,
      navigate: (p) => { paths.push(p); },
    });
    await store.submitPrompt("go");

    expect(paths).toEqual(["/run/run-resolved"]);
    expect(get(store).lastSubmitError).toBeNull();
  });
});
