import { describe, it, expect } from "bun:test";
import { cortexRunsPostBody } from "./cortex-runs-post-body.js";
import { defaultConfig } from "./types/agent-config.js";

describe("cortexRunsPostBody", () => {
  it("includes taskContext when non-empty", () => {
    const cfg = {
      ...defaultConfig(),
      taskContext: { project: "acme", environment: "staging" },
    };
    const body = cortexRunsPostBody("do the thing", cfg) as { taskContext?: Record<string, string> };
    expect(body.prompt).toBe("do the thing");
    expect(body.taskContext).toEqual({ project: "acme", environment: "staging" });
  });

  it("omits taskContext when empty", () => {
    const body = cortexRunsPostBody("x", defaultConfig()) as { taskContext?: unknown };
    expect(body.taskContext).toBeUndefined();
  });
});
