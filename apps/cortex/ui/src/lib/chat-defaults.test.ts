import { describe, expect, test } from "bun:test";
import { freshChatPayload, chatDefaultConfig } from "./chat-defaults.js";
import { todoGuidanceOn, setTodoGuidance } from "./todo-guidance.js";
import { cortexRunsPostBody } from "./cortex-runs-post-body.js";
import { mergeCortexAllowedTools, type CortexMetaToolsConfig } from "../../../server/services/cortex-agent-config.js";

describe("freshChatPayload", () => {
  test("uses the user's default provider and model, memory off, nothing the chat API would reject", async () => {
    const p = await freshChatPayload({ defaultProvider: "ollama", defaultModel: "qwen3:8b", ollamaEndpoint: "" });
    expect(p).toMatchObject({ provider: "ollama", model: "qwen3:8b", autoName: true, streamReasoningSteps: false });
    expect(typeof p.enableTools).toBe("boolean"); // same default as the New session modal
    expect(p.memory).toEqual({ working: false, episodic: false, semantic: false });
    expect("prompt" in p).toBe(false);
  });

  test("falls back to the provider's own default when no model is set", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () =>
        new Response(JSON.stringify({ models: [{ name: "m1", label: "M1" }, { name: "m2", label: "M2" }], default: "m2" }), {
          headers: { "content-type": "application/json" },
        }),
      { preconnect: (): void => {} },
    );
    try {
      const p = await freshChatPayload({ defaultProvider: "anthropic", defaultModel: "  ", ollamaEndpoint: "" });
      expect(p.model).toBe("m2");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("chat to-do default", () => {
  test("new chat config keeps a to-do list, with no other meta-tool turned on", () => {
    const mt = chatDefaultConfig().metaTools;
    expect(mt).toMatchObject({ enabled: true, todo: true, brief: false, find: false, pulse: false, recall: false, harnessSkill: false });
  });
  test("payload carries todo and it registers in the agent's allowed tools", async () => {
    const p = await freshChatPayload({ defaultProvider: "ollama", defaultModel: "m", ollamaEndpoint: "" });
    const mt = p.metaTools as CortexMetaToolsConfig;
    expect(mt.todo).toBe(true);
    expect(mergeCortexAllowedTools([], mt)).toContain("todo");
  });
  test("a stored session config with todo:false stays false", () => {
    const stored = { ...chatDefaultConfig(), metaTools: { ...chatDefaultConfig().metaTools, todo: false } };
    expect(stored.metaTools.todo).toBe(false);
  });
});

describe("keep to-do list current (opt-in guidance)", () => {
  test("default is off: no todoGuidance in the new chat config or payload", async () => {
    expect(chatDefaultConfig().metaTools.todoGuidance).toBeUndefined();
    expect(todoGuidanceOn(chatDefaultConfig().metaTools)).toBe(false);
    const p = await freshChatPayload({ defaultProvider: "ollama", defaultModel: "m", ollamaEndpoint: "" });
    expect((p.metaTools as CortexMetaToolsConfig).todoGuidance).toBeUndefined();
  });
  test("toggle round-trips through config -> post body", () => {
    const on = { ...chatDefaultConfig(), metaTools: setTodoGuidance(chatDefaultConfig().metaTools, true) };
    expect(todoGuidanceOn(on.metaTools)).toBe(true);
    const body = cortexRunsPostBody("hi", on);
    expect((body.metaTools as CortexMetaToolsConfig).todoGuidance).toEqual({ reminder: true, systemLine: true });
    const off = { ...on, metaTools: setTodoGuidance(on.metaTools, false) };
    expect(todoGuidanceOn(off.metaTools)).toBe(false);
    expect((cortexRunsPostBody("hi", off).metaTools as CortexMetaToolsConfig).todoGuidance).toEqual({ reminder: false, systemLine: false });
  });
  test("an existing session config without the field reads as off and survives the round trip", () => {
    const { todoGuidance: _g, ...legacy } = { ...chatDefaultConfig().metaTools, todoGuidance: undefined };
    const cfg = { ...chatDefaultConfig(), metaTools: legacy };
    expect(todoGuidanceOn(cfg.metaTools)).toBe(false);
    expect((cortexRunsPostBody("hi", cfg).metaTools as CortexMetaToolsConfig).todoGuidance).toBeUndefined();
  });
});
