import { describe, expect, test } from "bun:test";
import { freshChatPayload } from "./chat-defaults.js";

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
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ models: [{ name: "m1", label: "M1" }, { name: "m2", label: "M2" }], default: "m2" }), {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const p = await freshChatPayload({ defaultProvider: "anthropic", defaultModel: "  ", ollamaEndpoint: "" });
      expect(p.model).toBe("m2");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
