import { describe, it, expect } from "bun:test";
import type { ReactiveAgent } from "@reactive-agents/runtime";
import { durableApprovals } from "../services/durable-approvals.js";

const fakeAgent = (log: string[], name: string) => ({ dispose: async () => void log.push(name) }) as unknown as ReactiveAgent;

describe("durableApprovals.supersedeForAgent", () => {
  it("drops + disposes earlier paused runs of the same agent only", async () => {
    const log: string[] = [];
    const entry = (agentId: string, durableRunId: string) => ({ agentId, durableRunId, agent: fakeAgent(log, durableRunId), startedAt: 0 });
    durableApprovals.register(entry("a1", "r1"));
    durableApprovals.register(entry("a1", "r2"));
    durableApprovals.register(entry("a2", "r3"));
    durableApprovals.register(entry("a1", "r4"));

    expect(await durableApprovals.supersedeForAgent("a1", "r4")).toEqual(["r1", "r2"]);
    expect(durableApprovals.list().map((e) => e.durableRunId).sort()).toEqual(["r3", "r4"]);
    expect(log.sort()).toEqual(["r1", "r2"]);

    await durableApprovals.finalize("r3");
    await durableApprovals.finalize("r4");
  });
});
