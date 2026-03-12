import { describe, it, expect } from "bun:test";
import { ToolBuilder } from "../src/tool-builder.js";

describe("ToolBuilder", () => {
  it("builds with defaults", () => {
    const result = new ToolBuilder("my-tool").description("desc").build();
    expect(result.definition.name).toBe("my-tool");
    expect(result.definition.description).toBe("desc");
    expect(result.definition.parameters).toEqual([]);
    expect(result.definition.riskLevel).toBe("low");
    expect(result.definition.timeoutMs).toBe(30_000);
    expect(result.definition.requiresApproval).toBe(false);
    expect(result.definition.source).toBe("function");
  });

  it("adds required parameter", () => {
    const result = new ToolBuilder("t")
      .description("d")
      .param("url", "string", "Dataset URL", { required: true })
      .build();
    expect(result.definition.parameters).toHaveLength(1);
    expect(result.definition.parameters[0].name).toBe("url");
    expect(result.definition.parameters[0].required).toBe(true);
  });

  it("adds optional parameter with default", () => {
    const result = new ToolBuilder("t")
      .description("d")
      .param("format", "string", "Output format", { required: false, default: "json" })
      .build();
    expect(result.definition.parameters[0].required).toBe(false);
    expect(result.definition.parameters[0].default).toBe("json");
  });

  it("adds enum constraint", () => {
    const result = new ToolBuilder("t")
      .description("d")
      .param("type", "string", "Type", { enum: ["a", "b"] })
      .build();
    expect(result.definition.parameters[0].enum).toEqual(["a", "b"]);
  });

  it("overrides risk level", () => {
    const result = new ToolBuilder("t").description("d").riskLevel("high").build();
    expect(result.definition.riskLevel).toBe("high");
  });

  it("overrides timeout", () => {
    const result = new ToolBuilder("t").description("d").timeout(60_000).build();
    expect(result.definition.timeoutMs).toBe(60_000);
  });

  it("stores handler", () => {
    const fn = async () => ({ result: "ok" });
    const result = new ToolBuilder("t").description("d").handler(fn).build();
    expect(result.handler).toBe(fn);
  });

  it("throws if description not set", () => {
    expect(() => new ToolBuilder("t").build()).toThrow("ToolBuilder: description is required");
  });
});
