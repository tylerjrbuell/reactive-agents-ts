import { describe, expect, test } from "bun:test";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";

describe("normalizeCortexAgentConfig", () => {
  test("coerces numeric fields from strings", () => {
    const out = normalizeCortexAgentConfig({
      temperature: "0",
      maxTokens: "4096",
      maxIterations: "12",
      timeout: "30000",
    });
    expect(out.temperature).toBe(0);
    expect(out.maxTokens).toBe(4096);
    expect(out.maxIterations).toBe(12);
    expect(out.timeout).toBe(30000);
  });

  test("preserves temperature 0 (not treated as missing)", () => {
    const out = normalizeCortexAgentConfig({ temperature: 0 });
    expect(out.temperature).toBe(0);
  });

  test("normalizes tools to string array", () => {
    const out = normalizeCortexAgentConfig({
      tools: ["web-search", "", "file-read"],
    });
    expect(out.tools).toEqual(["web-search", "file-read"]);
  });

  test("maps strategy alias react → reactive (framework registry name)", () => {
    const out = normalizeCortexAgentConfig({ strategy: "react" });
    expect(out.strategy).toBe("reactive");
  });

  test("normalizes retryPolicy numbers and enabled flag", () => {
    const out = normalizeCortexAgentConfig({
      retryPolicy: { enabled: true, maxRetries: "3", backoffMs: "500" },
    });
    expect(out.retryPolicy).toEqual({
      enabled: true,
      maxRetries: 3,
      backoffMs: 500,
    });
  });
});
