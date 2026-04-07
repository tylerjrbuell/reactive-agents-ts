import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { modelsRouter } from "../api/models.js";

describe("/api/models/framework/:provider", () => {
  it("returns models for anthropic", async () => {
    const app = new Elysia().use(modelsRouter);
    const res = await app.handle(new Request("http://localhost/api/models/framework/anthropic"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { name: string; label: string }[] };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models.some((m) => m.name.includes("claude"))).toBe(true);
  });

  it("returns empty array for unknown provider without error", async () => {
    const app = new Elysia().use(modelsRouter);
    const res = await app.handle(new Request("http://localhost/api/models/framework/not-a-provider"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[] };
    expect(body.models).toEqual([]);
  });
});
