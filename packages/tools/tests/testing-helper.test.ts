import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { defineTool } from "../src/define-tool.js";
import { testTool, mockFetchOnce } from "../src/testing.js";

describe("testTool", () => {
  it("returns ok:true with the decoded value on success", async () => {
    const t = defineTool({
      name: "echo",
      description: "Echoes input",
      input: Schema.Struct({ text: Schema.String }),
      handler: async ({ text }) => ({ text }),
    });
    const result = await testTool(t, { text: "hi" });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ text: "hi" });
  });

  it("returns ok:false with the error on failure, doesn't throw", async () => {
    const t = defineTool({
      name: "always-fails",
      description: "Always throws",
      input: Schema.Struct({}),
      handler: async () => {
        throw new Error("boom");
      },
    });
    const result = await testTool(t, {});
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("mockFetchOnce", () => {
  it("stubs global.fetch for exactly one call, then restores it", async () => {
    const restore = mockFetchOnce({ status: 200, body: { hello: "world" } });
    const res = await fetch("https://example.test/anything");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
    restore();
  });
});
