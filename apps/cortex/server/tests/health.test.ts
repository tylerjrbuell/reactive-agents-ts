import { describe, it, expect } from "bun:test";
import { checkProviders } from "../api/health.js";

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
