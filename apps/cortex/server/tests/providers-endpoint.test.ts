import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { LLMProviderType } from "@reactive-agents/llm-provider";
import { modelsRouter } from "../api/models.js";

describe("GET /api/models/providers", () => {
  it("ids equal the framework provider literals minus custom, plus test", async () => {
    const app = new Elysia().use(modelsRouter);
    const res = await app.handle(new Request("http://localhost/api/models/providers"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string; label: string; local: boolean }[] };
    const expected = [...LLMProviderType.literals.filter((p) => p !== "custom"), "test"].sort();
    expect(body.providers.map((p) => p.id).sort()).toEqual(expected);
  });

  it("includes groq and xai with labels", async () => {
    const app = new Elysia().use(modelsRouter);
    const res = await app.handle(new Request("http://localhost/api/models/providers"));
    const body = (await res.json()) as { providers: { id: string; label: string; local: boolean }[] };
    for (const id of ["groq", "xai"]) {
      const p = body.providers.find((x) => x.id === id);
      expect(p).toBeDefined();
      expect(p?.label.length).toBeGreaterThan(0);
      expect(p?.local).toBe(false);
    }
    expect(body.providers.find((x) => x.id === "ollama")?.local).toBe(true);
  });
});
