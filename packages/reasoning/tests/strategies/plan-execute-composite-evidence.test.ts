// File: tests/strategies/plan-execute-composite-evidence.test.ts
//
// Repro (Workstream H verdict N3, 2026-11-06, `harness:evidence-missing`): the
// planner emitted a read step without its path, so plan repair ran it as a
// composite step (one ReAct pass scoped to file-read). The pass read the file,
// but the step's result was only the sub-kernel's closing text. The dependent
// analysis step got that text in DATA FROM PREVIOUS STEPS, never the file, and
// the write step after it wrote what the model guessed.
//
// The fix: a composite step's full result carries the tool results its pass
// observed, so a dependent step's request carries the data itself.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { compositeFullResult } from "../../src/strategies/planning/step-evidence.js";

const FILE_READ_SCHEMA = {
  name: "file-read",
  description: "Read a file",
  parameters: [{ name: "path", type: "string", description: "path", required: true }],
};
const FILE_WRITE_SCHEMA = {
  name: "file-write",
  description: "Write a file",
  parameters: [
    { name: "path", type: "string", description: "path", required: true },
    { name: "content", type: "string", description: "content", required: true },
  ],
};

/** The read result. The data token appears nowhere else in the run. */
const SHEET = "item,qty\nWIDGET-QZ9,3\nGADGET-KP4,40";

const PLAN = {
  steps: [
    // No path: plan repair runs this as a composite step scoped to file-read.
    { title: "Read the sheet", instruction: "Read the stock sheet.", type: "tool_call", toolName: "file-read", toolArgs: {}, rationale: { why: "need the data", confidence: 0.9 } },
    { title: "Find low items", instruction: "List the items whose qty is below 10.", type: "analysis", dependsOn: ["s1"] },
    { title: "Write the list", instruction: "Write the list.", type: "tool_call", toolName: "file-write", toolArgs: { path: "./low.txt", content: "{{from_step:s2}}" }, dependsOn: ["s2"], rationale: { why: "deliverable", confidence: 0.9 } },
  ],
};

describe("compositeFullResult", () => {
  it("a step planned as one tool call keeps the payload alone; other composites keep their text first", () => {
    expect(compositeFullResult("text", [], "file-read")).toBeUndefined();
    expect(compositeFullResult("text", ["A", "B"], "file-read")).toBe("A\n\n---\n\nB");
    expect(compositeFullResult("text", ["A"], undefined)).toBe("text\n\nTool results from this step:\nA");
  });
});

describe("plan-execute composite step carries its tool results to dependent steps", () => {
  it("the analysis step after a composite read step sees the file content", async () => {
    const prompts: string[] = [];
    const turns = TestLLMServiceLayer([
      { match: "planning agent", json: PLAN },
      { match: "Read the stock sheet", toolCall: { name: "file-read", args: { path: "./sheet.csv" } } },
      // The pass closes with prose that does not carry the data.
      { match: "Read the stock sheet", text: "FINAL ANSWER: The sheet has been read." },
      { match: "below 10", text: "WIDGET-QZ9" },
      { match: "GOAL:", text: "SATISFIED: complete." },
      { text: "Final synthesized answer." },
    ]);
    const recorded = Layer.effect(LLMService, Effect.map(LLMService, (llm) => LLMService.of({
      ...llm,
      complete: (req) => {
        prompts.push(JSON.stringify(req.messages));
        return llm.complete(req);
      },
    }))).pipe(Layer.provide(turns));
    const tools = mockToolServiceLayer({
      execute: (req: { toolName: string }) =>
        Effect.succeed({ success: true, result: req.toolName === "file-read" ? SHEET : "written" }),
      getTool: (name: string) => Effect.succeed(name === "file-write" ? FILE_WRITE_SCHEMA : FILE_READ_SCHEMA),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    });

    await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({
        taskDescription: "Read the stock sheet and write the low items to low.txt.",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["file-read", "file-write"],
        availableToolSchemas: [FILE_READ_SCHEMA, FILE_WRITE_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(Effect.provide(Layer.merge(recorded, tools))),
    ));

    const analysis = prompts.filter((p) => p.includes("INSTRUCTION: List the items whose qty is below 10."));
    expect(analysis.length).toBeGreaterThan(0);
    expect(analysis[0]).toContain("WIDGET-QZ9,3");
  });
});
