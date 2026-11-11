import { describe, it, expect } from "bun:test";
import { agentExportFilename, agentSourceBody, fetchAgentSource, generateAgentJson } from "./agent-export.js";
import { cortexRunsPostBody } from "./cortex-runs-post-body.js";
import { defaultConfig, type AgentConfig } from "./types/agent-config.js";

describe("agentSourceBody", () => {
  it("is the desk-run body without the prompt, named by the export", () => {
    const cfg = { ...defaultConfig(), provider: "anthropic", model: "claude-sonnet-4-6", tools: ["web-search"] };
    const body = agentSourceBody(cfg, "Research Bot");
    const { prompt: _p, ...run } = cortexRunsPostBody("", cfg);
    expect(body).toEqual({ ...run, agentName: "Research Bot" });
    expect("prompt" in body).toBe(false);
  });

  it("falls back to the config's agent name, else sends none", () => {
    expect(agentSourceBody({ ...defaultConfig(), agentName: "own" }, "  ").agentName).toBe("own");
    expect(agentSourceBody(defaultConfig(), "").agentName).toBeUndefined();
  });

  it("hydrates a sparse stored config instead of crashing", () => {
    // Saved agents can carry configs that predate newer fields.
    const sparse = { provider: "ollama", model: "qwen3:4b" } as unknown as AgentConfig;
    const body = agentSourceBody(sparse, "Legacy");
    expect(body.provider).toBe("ollama");
    expect(body.model).toBe("qwen3:4b");
  });
});

describe("fetchAgentSource", () => {
  it("posts the body and returns source + notInCode", async () => {
    let seen: { url: string; body: unknown } | undefined;
    const r = await fetchAgentSource(defaultConfig(), "Bot", async (url, init) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ source: "code", notInCode: [{ setting: "Meta tools", call: "withMetaTools" }] }));
    });
    expect(seen?.url).toEndWith("/api/agent-config/source");
    expect((seen?.body as { agentName?: string }).agentName).toBe("Bot");
    expect(r).toEqual({ ok: true, value: { source: "code", notInCode: [{ setting: "Meta tools", call: "withMetaTools" }] } });
  });

  it("returns the server's error on a failed export", async () => {
    const r = await fetchAgentSource(defaultConfig(), "Bot", async () => new Response(JSON.stringify({ error: "bad config" }), { status: 400 }));
    expect(r).toEqual({ ok: false, error: "bad config" });
  });

  it("returns a network failure as an error", async () => {
    const r = await fetchAgentSource(defaultConfig(), "Bot", async () => {
      throw new Error("offline");
    });
    expect(r).toEqual({ ok: false, error: "offline" });
  });
});

describe("agentExportFilename", () => {
  it("slugs the name", () => {
    expect(agentExportFilename("Research Bot!", "ts")).toBe("research-bot.ts");
    expect(agentExportFilename("  ", "json")).toBe("agent.json");
  });
});

describe("generateAgentJson", () => {
  it("serializes the config as pretty JSON", () => {
    const cfg = { ...defaultConfig(), model: "claude-sonnet-4-6" };
    const json = generateAgentJson(cfg, "Bot");
    const parsed = JSON.parse(json) as { name: string; config: { model: string } };
    expect(parsed.name).toBe("Bot");
    expect(parsed.config.model).toBe("claude-sonnet-4-6");
  });
});
