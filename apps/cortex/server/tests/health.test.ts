import { describe, it, expect } from "bun:test";
import { checkProviders, healthRouter } from "../api/health.js";
import pkg from "../../package.json" with { type: "json" };

describe("GET /api/health", () => {
  it("reports the Cortex package version, not a hard-coded one", async () => {
    const res = await healthRouter.handle(new Request("http://localhost/api/health/"));
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(pkg.version);
  });
});

describe("checkProviders", () => {
  it("returns missing when env var not set", () => {
    const result = checkProviders({ ANTHROPIC_API_KEY: undefined });
    expect(result.anthropic).toBe("missing");
  });

  it("returns ok when env var set", () => {
    const result = checkProviders({ ANTHROPIC_API_KEY: "sk-test" });
    expect(result.anthropic).toBe("ok");
  });

  it("returns missing for all by default with empty env", () => {
    const result = checkProviders({});
    expect(result.openai).toBe("missing");
    expect(result.gemini).toBe("missing");
  });
});
