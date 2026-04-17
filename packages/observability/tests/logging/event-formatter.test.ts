import { describe, it, expect } from "bun:test";
import { formatEvent } from "../../src/logging/event-formatter.js";
import type { LogEvent } from "../../src/types.js";

describe("formatEvent", () => {
  it("formats phase_started as → [phase:name]", () => {
    const event: LogEvent = {
      _tag: "phase_started",
      phase: "bootstrap",
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toBe("→ [phase:bootstrap] Starting...");
  });

  it("formats phase_complete success as ✓ [phase:name] duration", () => {
    const event: LogEvent = {
      _tag: "phase_complete",
      phase: "think",
      duration: 32500, // 32.5 seconds
      status: "success",
    };
    const result = formatEvent(event);
    expect(result).toBe("✓ [phase:think] 32.5s");
  });

  it("formats phase_complete warning with details", () => {
    const event: LogEvent = {
      _tag: "phase_complete",
      phase: "act",
      duration: 1500, // 1.5 seconds
      status: "warning",
      details: "High entropy",
    };
    const result = formatEvent(event);
    expect(result).toBe("⚠️ [phase:act] 1.5s — High entropy");
  });

  it("formats tool_call as → [tool:name] with iteration", () => {
    const event: LogEvent = {
      _tag: "tool_call",
      tool: "web-search",
      iteration: 1,
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toBe("  → [tool:web-search] call 1");
  });

  it("formats tool_result success with 2 decimal duration", () => {
    const event: LogEvent = {
      _tag: "tool_result",
      tool: "http-get",
      duration: 1200, // 1.20 seconds
      status: "success",
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toBe("  ✓ [tool:http-get] 1.20s");
  });

  it("formats tool_result error with error message", () => {
    const event: LogEvent = {
      _tag: "tool_result",
      tool: "web-search",
      duration: 500,
      status: "error",
      error: "API rate limit exceeded",
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toBe("  ✗ [tool:web-search] 0.50s — API rate limit exceeded");
  });

  it("formats metric with unit", () => {
    const event: LogEvent = {
      _tag: "metric",
      name: "entropy",
      value: 0.45,
      unit: "composite",
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toBe("  📊 [metric:entropy] 0.45 composite");
  });

  it("formats warning with context", () => {
    const event: LogEvent = {
      _tag: "warning",
      message: "Model entropy flat for 3 iterations",
      context: "phase:think",
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toBe("⚠️ [warning] Model entropy flat for 3 iterations (phase:think)");
  });

  it("formats error with message and Error object", () => {
    const error = new Error("Permission denied");
    const event: LogEvent = {
      _tag: "error",
      message: "Tool execution failed",
      error: {
        name: "PermissionError",
        message: "Permission denied",
      },
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toBe("✗ [error] Tool execution failed: Permission denied");
  });

  it("formats iteration with summary truncation", () => {
    const longSummary = "I should search for information about this topic to understand it better";
    const event: LogEvent = {
      _tag: "iteration",
      iteration: 5,
      phase: "thought",
      summary: longSummary,
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toContain("[iter:5:thought]");
    expect(result).toContain("I should search for information about this topic to understa");
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(110);
  });

  it("formats completion success", () => {
    const event: LogEvent = {
      _tag: "completion",
      success: true,
      summary: "Task completed in 45s with 12,500 tokens",
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toBe("✓ [completion] Task completed in 45s with 12,500 tokens");
  });

  it("formats notice with info level", () => {
    const event: LogEvent = {
      _tag: "notice",
      level: "info",
      title: "Telemetry Enabled",
      message: "Anonymous entropy data...",
      dismissible: true,
      timestamp: new Date(),
    };
    const result = formatEvent(event);
    expect(result).toContain("ℹ️");
    expect(result).toContain("Telemetry Enabled");
    expect(result).toContain("Anonymous entropy data...");
  });
});
