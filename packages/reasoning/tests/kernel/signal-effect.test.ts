import { describe, it, expect } from "bun:test";
import { classifySignalEffect } from "../../src/kernel/loop/runner-helpers/signal-effect.js";

const step = (toolName: string, displayText = ""): any => ({
  type: "observation",
  content: displayText,
  metadata: { observationResult: { toolName, displayText } },
});

describe("signal-effect classifier (Task 4)", () => {
  it("denied-tool-retry: remediated when retried with changed args", () => {
    const r = classifySignalEffect({ tool: "file-write", policy: "denied-tool-retry" }, [step("file-write", "✓ Written to /x")]);
    expect(r.response).toBe("remediated");
  });
  it("denied-tool-retry: contradicted when repeated denial", () => {
    const r = classifySignalEffect({ tool: "file-write", policy: "denied-tool-retry" }, [step("file-write", "blocked: path traversal")]);
    expect(r.response).toBe("contradicted");
  });
  it("denied-tool-retry: ignored when different tool called", () => {
    const r = classifySignalEffect({ tool: "file-write", policy: "denied-tool-retry" }, [step("web-search", "results")]);
    expect(r.response).toBe("ignored");
  });
  it("denied-tool-retry: ambiguous with no act", () => {
    const r = classifySignalEffect({ tool: "file-write", policy: "denied-tool-retry" }, []);
    expect(r.response).toBe("ambiguous");
  });
  it("alternate-tool: remediated when alternate called", () => {
    const r = classifySignalEffect({ tool: "web-search", policy: "alternate-tool" }, [step("web-search", "ok")]);
    expect(r.response).toBe("remediated");
  });
  it("required-tool: remediated when required tool called", () => {
    const r = classifySignalEffect({ tool: "file-write", policy: "required-tool" }, [step("file-write", "ok")]);
    expect(r.response).toBe("remediated");
  });
  it("synthesize: remediated when synthesis progressed", () => {
    const r = classifySignalEffect({ policy: "synthesize" }, [{ type: "thought", content: "done" } as any]);
    expect(r.response).toBe("remediated");
  });
  it("unknown signal: ambiguous", () => {
    const r = classifySignalEffect(undefined, [step("x", "y")]);
    expect(r.response).toBe("ambiguous");
  });
});
