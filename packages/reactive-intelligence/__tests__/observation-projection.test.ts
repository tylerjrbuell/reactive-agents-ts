import { test, expect } from "bun:test"
import { projectObservationFromTrace } from "../src/learning/observation-projection"
import type { Trace } from "@reactive-agents/trace"

test("projects observation fields from a completed run trace", () => {
  const trace: Trace = {
    runId: "r",
    events: [
      {
        kind: "run-started",
        runId: "r",
        timestamp: 1,
        iter: -1,
        seq: 0,
        task: "t",
        model: "cogito:14b",
        provider: "ollama",
        config: {},
      },
      { kind: "iteration-enter", runId: "r", timestamp: 2, iter: 1, seq: 1 },
      {
        kind: "tool-call-start",
        runId: "r",
        timestamp: 3,
        iter: 1,
        seq: 2,
        toolName: "web-search",
      },
      {
        kind: "tool-call-end",
        runId: "r",
        timestamp: 4,
        iter: 1,
        seq: 3,
        toolName: "web-search",
        durationMs: 100,
        ok: true,
      },
      { kind: "iteration-exit", runId: "r", timestamp: 5, iter: 1, seq: 4 },
      {
        kind: "run-completed",
        runId: "r",
        timestamp: 6,
        iter: 1,
        seq: 5,
        status: "success",
        totalTokens: 500,
        totalCostUsd: 0,
        durationMs: 5,
      },
    ],
  }

  const obs = projectObservationFromTrace(trace)
  expect(obs).not.toBeNull()
  expect(obs!.modelId).toBe("cogito:14b")
  expect(obs!.totalTurnCount).toBe(1)
  expect(obs!.classifierActuallyCalled).toContain("web-search")
  expect(obs!.argValidityRate).toBe(1)
  expect(obs!.dialect).toBe("none")
})

test("returns null when run-started is missing", () => {
  const trace: Trace = {
    runId: "r",
    events: [
      {
        kind: "run-completed",
        runId: "r",
        timestamp: 6,
        iter: 1,
        seq: 0,
        status: "success",
        totalTokens: 100,
        totalCostUsd: 0,
        durationMs: 1,
      },
    ],
  }

  expect(projectObservationFromTrace(trace)).toBeNull()
})

test("returns null when run-completed is missing", () => {
  const trace: Trace = {
    runId: "r",
    events: [
      {
        kind: "run-started",
        runId: "r",
        timestamp: 1,
        iter: -1,
        seq: 0,
        task: "t",
        model: "gpt-4o",
        provider: "openai",
        config: {},
      },
    ],
  }

  expect(projectObservationFromTrace(trace)).toBeNull()
})

test("reads dialect from config when present", () => {
  const trace: Trace = {
    runId: "r",
    events: [
      {
        kind: "run-started",
        runId: "r",
        timestamp: 1,
        iter: -1,
        seq: 0,
        task: "t",
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        config: { dialect: "react" },
      },
      {
        kind: "run-completed",
        runId: "r",
        timestamp: 2,
        iter: 0,
        seq: 1,
        status: "success",
        totalTokens: 50,
        totalCostUsd: 0,
        durationMs: 1,
      },
    ],
  }

  const obs = projectObservationFromTrace(trace)
  expect(obs).not.toBeNull()
  expect(obs!.dialect).toBe("react")
})

test("argValidityRate is 0 when there are no tool calls", () => {
  const trace: Trace = {
    runId: "r",
    events: [
      {
        kind: "run-started",
        runId: "r",
        timestamp: 1,
        iter: -1,
        seq: 0,
        task: "t",
        model: "claude-haiku-3-5",
        provider: "anthropic",
        config: {},
      },
      {
        kind: "run-completed",
        runId: "r",
        timestamp: 2,
        iter: 0,
        seq: 1,
        status: "success",
        totalTokens: 50,
        totalCostUsd: 0,
        durationMs: 1,
      },
    ],
  }

  const obs = projectObservationFromTrace(trace)
  expect(obs).not.toBeNull()
  expect(obs!.argValidityRate).toBe(0)
  expect(obs!.classifierActuallyCalled).toHaveLength(0)
})

test("counts subagent invocations and successes", () => {
  const trace: Trace = {
    runId: "r",
    events: [
      {
        kind: "run-started",
        runId: "r",
        timestamp: 1,
        iter: -1,
        seq: 0,
        task: "t",
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        config: {},
      },
      { kind: "iteration-enter", runId: "r", timestamp: 2, iter: 1, seq: 1 },
      {
        kind: "tool-call-end",
        runId: "r",
        timestamp: 3,
        iter: 1,
        seq: 2,
        toolName: "spawn-agent",
        ok: true,
      },
      {
        kind: "tool-call-end",
        runId: "r",
        timestamp: 4,
        iter: 1,
        seq: 3,
        toolName: "spawn-agent",
        ok: false,
      },
      {
        kind: "run-completed",
        runId: "r",
        timestamp: 5,
        iter: 1,
        seq: 4,
        status: "success",
        totalTokens: 200,
        totalCostUsd: 0,
        durationMs: 3,
      },
    ],
  }

  const obs = projectObservationFromTrace(trace)
  expect(obs).not.toBeNull()
  expect(obs!.subagentInvoked).toBe(2)
  expect(obs!.subagentSucceeded).toBe(1)
})
