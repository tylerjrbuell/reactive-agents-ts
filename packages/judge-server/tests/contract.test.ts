// Run: bun test packages/judge-server/tests/contract.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { JudgeRequest, JudgeResponse, ReproducibilityMetadata, JudgeLayerResult } from "../src/contract.js";

describe("judge RPC contract — JudgeRequest", () => {
  it("parses a valid JudgeRequest", () => {
    const valid = {
      taskId: "t-001",
      sutResponse: "Paris is the capital of France.",
      taskInput: { question: "What is the capital of France?" },
      sutModel: "claude-sonnet-4-6",
      runId: "run-abc-123",
    };
    const result = Schema.decodeUnknownSync(JudgeRequest)(valid);
    expect(result.taskId).toBe("t-001");
    expect(result.sutModel).toBe("claude-sonnet-4-6");
  }, 15000);

  it("accepts an optional taskCriteria field", () => {
    const valid = {
      taskId: "t-002",
      sutResponse: "ok",
      taskInput: {},
      sutModel: "m",
      runId: "r",
      taskCriteria: "must mention Paris",
    };
    const result = Schema.decodeUnknownSync(JudgeRequest)(valid);
    expect(result.taskCriteria).toBe("must mention Paris");
  }, 15000);

  it("rejects a JudgeRequest missing sutModel (Rule-4 enforcement requires it)", () => {
    const invalid = {
      taskId: "t-001",
      sutResponse: "x",
      taskInput: {},
      runId: "r",
    };
    expect(() => Schema.decodeUnknownSync(JudgeRequest)(invalid)).toThrow();
  }, 15000);

  it("rejects a JudgeRequest missing runId", () => {
    const invalid = {
      taskId: "t-001",
      sutResponse: "x",
      taskInput: {},
      sutModel: "m",
    };
    expect(() => Schema.decodeUnknownSync(JudgeRequest)(invalid)).toThrow();
  }, 15000);
});

describe("judge RPC contract — JudgeResponse", () => {
  it("parses a valid JudgeResponse with required reproducibility metadata", () => {
    const valid = {
      taskId: "t-001",
      passed: true,
      overallScore: 0.92,
      recommendation: "accept" as const,
      layerResults: [],
      reproducibility: {
        judgeModelSha: "abc123",
        judgeCodeSha: "def456",
      },
    };
    const result = Schema.decodeUnknownSync(JudgeResponse)(valid);
    expect(result.reproducibility.judgeModelSha).toBe("abc123");
    expect(result.passed).toBe(true);
  }, 15000);

  it("rejects a JudgeResponse missing reproducibility (Rule 4 demands it)", () => {
    const invalid = {
      taskId: "t-001",
      passed: true,
      overallScore: 0.92,
      recommendation: "accept",
      layerResults: [],
    };
    expect(() => Schema.decodeUnknownSync(JudgeResponse)(invalid)).toThrow();
  }, 15000);

  it("rejects a JudgeResponse with invalid recommendation literal", () => {
    const invalid = {
      taskId: "t-001",
      passed: true,
      overallScore: 0.5,
      recommendation: "maybe",
      layerResults: [],
      reproducibility: { judgeModelSha: "a", judgeCodeSha: "b" },
    };
    expect(() => Schema.decodeUnknownSync(JudgeResponse)(invalid)).toThrow();
  }, 15000);

  it("accepts JudgeLayerResult with optional details", () => {
    const layer = { layerName: "factuality", score: 0.9, passed: true };
    const result = Schema.decodeUnknownSync(JudgeLayerResult)(layer);
    expect(result.score).toBe(0.9);
  }, 15000);
});

describe("judge RPC contract — ReproducibilityMetadata", () => {
  it("requires both judgeModelSha and judgeCodeSha", () => {
    const valid = { judgeModelSha: "m", judgeCodeSha: "c" };
    const result = Schema.decodeUnknownSync(ReproducibilityMetadata)(valid);
    expect(result.judgeModelSha).toBe("m");
    expect(result.judgeCodeSha).toBe("c");
  }, 15000);
});
