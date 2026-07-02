import { describe, it, expect } from "bun:test";
import { deriveConfigFields } from "../src/capability/config-fields.js";

describe("deriveConfigFields", () => {
  it("emits descriptors covering top-level AgentConfig fields", () => {
    const paths = deriveConfigFields().map((f) => f.path);
    expect(paths).toContain("provider");
    expect(paths).toContain("model");
    expect(paths).toContain("temperature");
    expect(paths).toContain("systemPrompt");
  });

  it("flattens nested structs into dotted paths", () => {
    const paths = deriveConfigFields().map((f) => f.path);
    expect(paths).toContain("execution.maxIterations");
    expect(paths).toContain("execution.timeoutMs");
    expect(paths).toContain("reasoning.defaultStrategy");
  });

  it("captures enum literals as enumValues", () => {
    const provider = deriveConfigFields().find((f) => f.path === "provider");
    expect(provider?.type).toBe("enum");
    expect(provider?.enumValues).toContain("anthropic");
    expect(provider?.enumValues).toContain("ollama");
  });

  it("marks required vs optional correctly", () => {
    const fields = deriveConfigFields();
    expect(fields.find((f) => f.path === "provider")?.optional).toBe(false);
    expect(fields.find((f) => f.path === "temperature")?.optional).toBe(true);
  });

  it("classifies scalar types", () => {
    const fields = deriveConfigFields();
    expect(fields.find((f) => f.path === "temperature")?.type).toBe("number");
    expect(fields.find((f) => f.path === "systemPrompt")?.type).toBe("string");
    expect(fields.find((f) => f.path === "execution.strictValidation")?.type).toBe("boolean");
  });
});
