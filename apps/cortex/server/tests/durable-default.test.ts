/**
 * Durable runs are on by default in Cortex (owner decision 2026-11-17): Stop, Pause and a crash
 * leave a run Continue can resume. An explicit `durableRuns.enabled: false` stays off, on every path.
 */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { durableRunsEnabled, effectiveDurableRuns } from "../services/durable-default.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { applySchema } from "../db/schema.js";
import { getChatSession } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";

describe("effectiveDurableRuns", () => {
  it("is on when the config has no durableRuns key", () => {
    expect(effectiveDurableRuns({})).toEqual({ enabled: true });
    expect(durableRunsEnabled({})).toBe(true);
  });

  it("is on for an empty or partial durableRuns object, keeping dir and checkpointEvery", () => {
    expect(effectiveDurableRuns({ durableRuns: {} })).toEqual({ enabled: true });
    expect(effectiveDurableRuns({ durableRuns: { dir: " /x ", checkpointEvery: 2 } })).toEqual({ enabled: true, dir: "/x", checkpointEvery: 2 });
  });

  it("honours an explicit off", () => {
    expect(effectiveDurableRuns({ durableRuns: { enabled: false, dir: "/x" } })).toBeUndefined();
    expect(durableRunsEnabled({ durableRuns: { enabled: false } })).toBe(false);
  });

  it("builds none for an ineligible agent (a tools-off chat)", () => {
    expect(effectiveDurableRuns({}, { eligible: false })).toBeUndefined();
    expect(effectiveDurableRuns({}, { eligible: true })).toEqual({ enabled: true });
  });
});

describe("the default reaches the gateway and chat build paths", () => {
  it("gateway agents build durable unless the saved config says off", () => {
    const base = { agentId: "a", name: "A", mcpConfigs: [] };
    expect(gatewayConfigToBuildParams({ ...base, config: { provider: "test" } }).durableRuns).toEqual({ enabled: true });
    expect(gatewayConfigToBuildParams({ ...base, config: { provider: "test", durableRuns: { enabled: false } } }).durableRuns).toBeUndefined();
  });

  it("a saved config keeps an explicit off through normalisation, and a legacy config without the key reads as on", () => {
    expect(normalizeCortexAgentConfig({ provider: "test", durableRuns: { enabled: false } }).durableRuns).toEqual({ enabled: false });
    expect(durableRunsEnabled(normalizeCortexAgentConfig({ provider: "test" }))).toBe(true);
  });

  it("a chat session created with durable off stores the off", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const svc = new ChatSessionService(db);
    const id = await svc.createSession({ agentConfig: { provider: "test", durableRuns: { enabled: false } } });
    expect(durableRunsEnabled(getChatSession(db, id)!.agentConfig)).toBe(false);
    await svc.disposeAll();
    db.close();
  });
});
