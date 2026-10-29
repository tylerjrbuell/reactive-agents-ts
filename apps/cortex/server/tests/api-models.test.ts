import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createModelsRouter } from "../api/models.js";
import { listFrameworkModelsForProvider } from "@reactive-agents/llm-provider";

/** Discovery stubbed to "failed": presets only, no keys / network needed. */
const presetsOnly = () =>
  createModelsRouter({
    fetch: (() => Promise.reject(new Error("no network"))) as unknown as typeof fetch,
    resolve: async (provider) => ({
      models: listFrameworkModelsForProvider(provider).map((m) => ({ id: m.name, label: m.label, source: "preset" as const, supportsThinking: null })),
      live: false,
    }),
  });

describe("/api/models/:provider", () => {
  it("returns models for anthropic", async () => {
    const app = new Elysia().use(presetsOnly());
    const res = await app.handle(new Request("http://localhost/api/models/anthropic"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { name: string; label: string }[] };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models.some((m) => m.name.includes("claude"))).toBe(true);
  });

  it("returns empty array for unknown provider without error", async () => {
    const app = new Elysia().use(presetsOnly());
    const res = await app.handle(new Request("http://localhost/api/models/not-a-provider"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[] };
    expect(body.models).toEqual([]);
  });
});
