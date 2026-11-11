import { describe, expect, it } from "bun:test";
import { chatConfigFromLaunch, runToChatSession, seedTurnsOf } from "./run-to-chat-session.js";

const launch = {
  prompt: "Summarize the release notes",
  agentName: "release-bot",
  variables: [{ name: "x" }],
  variableValues: { x: 1 },
  provider: "ollama",
  model: "qwen3:14b",
  strategy: "plan-execute-reflect",
  maxIterations: 12,
  tools: ["web-search"],
  workspace: "/tmp/ws",
  terminalTools: true,
  rawConfig: { reasoning: { maxIterations: 12 } },
};

describe("runToChatSession", () => {
  it("opens the chat session that started the run instead of forking it", () => {
    expect(runToChatSession({ runId: "r1", title: "t", chatSessionId: "s9", launchParams: launch })).toEqual({ kind: "open", sessionId: "s9" });
  });

  it("creates a session with the run's recorded config, its id and the seeded exchange", () => {
    const plan = runToChatSession({
      runId: "r1",
      title: "Release notes",
      answer: "Here is the summary.",
      provider: "anthropic",
      model: "claude",
      launchParams: launch,
    });
    if (plan.kind !== "create") throw new Error("expected create");
    expect(plan.configRecorded).toBe(true);
    const b = plan.body;
    expect(b.name).toBe("Release notes");
    expect(b.runId).toBe("r1");
    // The snapshot wins over the reported provider/model, and carries the rest of the config.
    expect(b.provider).toBe("ollama");
    expect(b.model).toBe("qwen3:14b");
    expect(b.strategy).toBe("plan-execute-reflect");
    expect(b.maxIterations).toBe(12);
    expect(b.tools).toEqual(["web-search"]);
    expect(b.workspace).toBe("/tmp/ws");
    expect(b.terminalTools).toBe(true);
    expect(b.rawConfig).toEqual({ reasoning: { maxIterations: 12 } });
    // Launch-only inputs never reach the chat body.
    for (const k of ["prompt", "agentName", "variables", "variableValues"]) expect(k in b).toBe(false);
    // The prompt is the seeded user turn.
    expect(b.seedTurns).toEqual([
      { role: "user", content: "Summarize the release notes" },
      { role: "assistant", content: "Here is the summary." },
    ]);
  });

  it("prefers the recorded task (AgentStarted.task) over the launch prompt", () => {
    const plan = runToChatSession({ runId: "r1", title: "t", task: "Actual task", answer: "A", launchParams: launch });
    if (plan.kind !== "create") throw new Error("expected create");
    expect(plan.body.seedTurns?.[0]).toEqual({ role: "user", content: "Actual task" });
  });

  it("without a snapshot uses the provider and model the run reported, and says so", () => {
    const plan = runToChatSession({ runId: "r2", title: "t", task: "Q", answer: "A", provider: "ollama", model: "llama3.2:3b" }, { provider: "anthropic", model: "claude" });
    if (plan.kind !== "create") throw new Error("expected create");
    expect(plan.configRecorded).toBe(false);
    expect(plan.body.provider).toBe("ollama");
    expect(plan.body.model).toBe("llama3.2:3b");
  });

  it("falls back to the chat defaults as a pair when nothing was recorded", () => {
    const plan = runToChatSession({ runId: "r3", title: "t" }, { provider: "anthropic", model: "claude" });
    if (plan.kind !== "create") throw new Error("expected create");
    expect(plan.body.provider).toBe("anthropic");
    expect(plan.body.model).toBe("claude");
    expect(plan.body.seedTurns).toBeUndefined();
  });

  it("never mixes a snapshot provider with a reported model", () => {
    const plan = runToChatSession({ runId: "r4", title: "t", provider: "anthropic", model: "claude", launchParams: { prompt: "p", provider: "ollama" } });
    if (plan.kind !== "create") throw new Error("expected create");
    expect(plan.body.provider).toBe("ollama");
    expect(plan.body.model).toBeUndefined();
  });

  it("clips a long title for the session name", () => {
    const plan = runToChatSession({ runId: "r5", title: "x".repeat(100) });
    if (plan.kind !== "create") throw new Error("expected create");
    expect(plan.body.name.length).toBe(60);
  });
});

describe("seedTurnsOf", () => {
  it("seeds nothing without an answer", () => {
    expect(seedTurnsOf("Q", "")).toEqual([]);
    expect(seedTurnsOf("Q", undefined)).toEqual([]);
  });
  it("seeds the answer alone when the task is unknown", () => {
    expect(seedTurnsOf(undefined, "A")).toEqual([{ role: "assistant", content: "A" }]);
  });
});

describe("chatConfigFromLaunch", () => {
  it("drops run-only keys and empty values", () => {
    expect(chatConfigFromLaunch({ prompt: "p", provider: "x", model: null, strategy: undefined })).toEqual({ provider: "x" });
  });
});
