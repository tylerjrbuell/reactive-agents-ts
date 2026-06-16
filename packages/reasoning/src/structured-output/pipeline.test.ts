
import { describe as d2, it as it2, expect as e2 } from "bun:test";
import { buildStructuredPrompt as bsp } from "./pipeline.js";
d2("buildStructuredPrompt — shape-aware", () => {
  it2("says 'JSON array' for a top-level array schema", () => {
    const arrJs = JSON.stringify({ type: "array", items: { type: "object", properties: { a: { type: "number" } } } });
    const p = bsp({ prompt: "x", schema: undefined as never } as never, arrJs);
    e2(p).toContain("JSON array");
    e2(p).not.toContain("top-level keys");
  });
  it2("says 'JSON object' for an object schema", () => {
    const objJs = JSON.stringify({ type: "object", properties: { a: { type: "number" } } });
    const p = bsp({ prompt: "x", schema: undefined as never } as never, objJs);
    e2(p).toContain("JSON object");
  });
});
