// Run: bun test packages/reasoning/tests/kernel/seam-recall-read.test.ts --timeout 20000
//
// Cortex trace 01M7TERZAVP2RS489WEBJ3HY7H (gemini, 2048-token fallback window):
// `recall({ key: "_tool_result_1", full: true })` came back as a 324-char
// "[recall result — compressed preview]": the recall JSON was compressed like
// any tool result (R1's window-share budget was 2048 chars) and re-stored as a
// new `_tool_result_N`. The duplicate guard then replayed that preview, and the
// model issued 36 recall calls without ever seeing the content.
//
// Pinned here (attend/recall-read.ts, wired in act/tool-execution.ts):
//   - a full read that fits the remaining context returns the content in full;
//   - one that does not says so (total size, how much fits), shows the first
//     section and names the next-section call (`full: true, start: N`);
//   - `start` from the model's call reads that section (the kernel reads it;
//     the tool's advertised schema has no offset parameter);
//   - a repeated identical read is replayed with the duplicate note, never
//     re-compressed or re-stored.
//
// RED-ON-CUT (measured 2026-11-19): drop the `recallRead` branch in
// `executeNativeToolCall` (tool-execution.ts): the 2048-window run cases go red
// (the read comes back as a compressed preview with a stored key).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, rootContext } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import { makeRecallHandler } from "@reactive-agents/tools";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import {
  conversationChars,
  MIN_RECALL_SECTION_CHARS,
  recallReadRequest,
  remainingContextChars,
  shapeRecallRead,
} from "../../src/kernel/capabilities/attend/recall-read.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";

/** 1,000 numbered 30-char lines (30,000 chars): any offset names its line. */
const DOC = Array.from({ length: 1000 }, (_, i) => `L${String(i).padStart(5, "0")}: agents-report-filler-x`).join("\n");

describe("shapeRecallRead (pure)", () => {
  const store = new Map([["k", DOC]]);

  it("recallReadRequest: only a full or sectioned read of a key", () => {
    expect(recallReadRequest({ key: "k", full: true })).toEqual({ key: "k", start: 0 });
    expect(recallReadRequest({ key: "k", full: true, start: 120.7 })).toEqual({ key: "k", start: 120 });
    expect(recallReadRequest({ key: "k", start: 50 })).toEqual({ key: "k", start: 50 });
    expect(recallReadRequest({ key: "k" })).toBeUndefined(); // preview read
    expect(recallReadRequest({ key: "k", content: "x" })).toBeUndefined(); // write
    expect(recallReadRequest({ key: "k", full: true, query: "agents" })).toBeUndefined(); // in-entry search
    expect(recallReadRequest({})).toBeUndefined(); // list
  });

  it("remainingContextChars: window minus the reserved quarter minus the conversation, never negative", () => {
    expect(remainingContextChars(2048, 0)).toBe(6144);
    expect(remainingContextChars(2048, 5000)).toBe(1144);
    expect(remainingContextChars(2048, 90_000)).toBe(0);
    expect(remainingContextChars(undefined, 0)).toBe(98_304);
    expect(conversationChars([{ content: "abcd" }, { content: [{ type: "text", text: "x" }] }, null])).toBeGreaterThan(4);
    expect(conversationChars(undefined)).toBe(0);
  });

  it("fits: the whole content, plain text under a one-line header", () => {
    const out = shapeRecallRead({ toolArgs: { key: "k", full: true }, toolResult: "{}", scratchpad: store, windowTokens: 128_000 })!;
    expect(out.startsWith(`[recall "k": full content, ${DOC.length} chars]\n`)).toBe(true);
    expect(out.endsWith(DOC)).toBe(true);
  });

  it("2048-token window: says the size and how much fits, shows that section, names the next-section call", () => {
    const out = shapeRecallRead({ toolArgs: { key: "k", full: true }, toolResult: "{}", scratchpad: store, windowTokens: 2048, usedChars: 2144 })!;
    expect(out).toContain(`${DOC.length} chars; about 4000 chars fit in the remaining context`);
    expect(out).toContain(`recall("k", full: true, start: 4000)`);
    expect(out.endsWith(DOC.slice(0, 4000))).toBe(true);
    expect(out).not.toContain("compressed preview");
  });

  it("nothing fits: still a minimum section, with the true fit stated", () => {
    const out = shapeRecallRead({ toolArgs: { key: "k", full: true }, toolResult: "{}", scratchpad: store, windowTokens: 2048, usedChars: 50_000 })!;
    expect(out).toContain("about 0 chars fit");
    expect(out.endsWith(DOC.slice(0, MIN_RECALL_SECTION_CHARS))).toBe(true);
  });

  it("start: reads that section; the tail that fits is labelled the rest; past the end says so", () => {
    const mid = shapeRecallRead({ toolArgs: { key: "k", full: true, start: 20_010 }, toolResult: "{}", scratchpad: store, windowTokens: 2048, usedChars: 2144 })!;
    expect(mid.endsWith(DOC.slice(20_010, 24_010))).toBe(true);
    expect(mid).toContain("start: 24010");
    const tail = shapeRecallRead({ toolArgs: { key: "k", full: true, start: 29_500 }, toolResult: "{}", scratchpad: store, windowTokens: 2048 })!;
    expect(tail).toContain("(the rest of it)");
    expect(tail.endsWith(DOC.slice(29_500))).toBe(true);
    expect(shapeRecallRead({ toolArgs: { key: "k", start: 40_000 }, toolResult: "{}", scratchpad: store })).toContain("past the end");
  });

  it("no scratchpad entry: reads the tool result's content field; a miss leaves the tool result as is", () => {
    const toolResult = JSON.stringify({ key: "other", content: "stored note", bytes: 11, truncated: false });
    expect(shapeRecallRead({ toolArgs: { key: "other", full: true }, toolResult })).toBe(`[recall "other": full content, 11 chars]\nstored note`);
    expect(shapeRecallRead({ toolArgs: { key: "gone", full: true }, toolResult: JSON.stringify({ found: false, key: "gone" }) })).toBeUndefined();
  });
});

const SCHEMAS = [
  { name: "get_doc", description: "fetch a long report", parameters: [{ name: "id", type: "string", required: true }] },
  {
    name: "recall",
    description: "read a stored key",
    parameters: [
      { name: "key", type: "string", required: true },
      { name: "full", type: "boolean", required: false },
    ],
  },
];

const toolLayer = mockToolServiceLayer({
  execute: (req) => {
    const r = req as { toolName: string; arguments?: Record<string, unknown> };
    if (r.toolName === "recall") {
      return makeRecallHandler()(r.arguments ?? {}).pipe(Effect.map((result) => ({ success: true, result })), Effect.orDie);
    }
    return Effect.succeed({ success: true, result: DOC });
  },
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [{ name: "id", type: "string", required: true }] }),
});

const input: KernelInput = {
  task: "Read the long report and summarize the last line.",
  availableToolSchemas: SCHEMAS,
  metaTools: { recall: true },
  // The trace's 2048-token fallback window.
  contextProfile: { tier: "frontier", maxTokens: 2048 },
  calibration: { observationHandling: "uses-recall" },
} as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 6,
  strategy: "reactive",
  kernelType: "react",
  taskId: "recall-read-2048",
  modelId: "gemini-flash-latest",
};

type Turn = Parameters<typeof TestLLMServiceLayer>[0][number];
const runScript = (reads: readonly Turn[]) =>
  Effect.runPromise(
    withRunScope(rootContext("recall-read-2048", "agent-recall"))(
      runPass(reactKernel, input, opts),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestLLMServiceLayer([
            { toolCall: { name: "get_doc", args: { id: "r1" } } },
            ...reads,
            { text: "The last line is L00999." },
          ]),
          toolLayer,
          EventBusLive,
        ),
      ),
    ),
  );

const recallObservations = (pass: Awaited<ReturnType<typeof runScript>>) =>
  pass.steps.filter((s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "recall");

const FULL_READ: Turn = { toolCall: { name: "recall", args: { key: "_tool_result_1", full: true } } };

describe("a 2048-token window run: recall(full: true) never comes back as a compressed preview", () => {
  it("over budget: the size, the fit and a next-section call, with that section's content; not re-stored", async () => {
    const recalls = recallObservations(await runScript([FULL_READ, FULL_READ]));
    expect(recalls.length).toBe(2);
    const first = recalls[0]!.content ?? "";
    expect(first).not.toContain("compressed preview");
    expect(first).toContain(`[recall "_tool_result_1": ${DOC.length} chars; about `);
    expect(first).toContain(`recall("_tool_result_1", full: true, start: `);
    expect(first).toContain("L00000: agents-report-filler-x");
    expect(recalls[0]!.metadata?.storedKey).toBeUndefined();

    // The identical repeat: replayed with the duplicate note, not re-compressed or re-stored.
    const repeat = recalls[1]!.content ?? "";
    expect(repeat).not.toContain("compressed preview");
    expect(repeat).toContain("Already fetched");
    expect(repeat).toContain(`[recall "_tool_result_1": ${DOC.length} chars; about `);
    expect(recalls[1]!.metadata?.storedKey).toBeUndefined();
  }, 20000);

  it("a section read: `start` from the model's call reads from there (here: the rest, through the end)", async () => {
    const recalls = recallObservations(
      await runScript([{ toolCall: { name: "recall", args: { key: "_tool_result_1", full: true, start: 30_100 } } }]),
    );
    expect(recalls.length).toBe(1);
    const section = recalls[0]!.content ?? "";
    expect(section).toContain("(the rest of it)");
    expect(section).toContain("L00999: agents-report-filler-x");
    expect(section.endsWith(DOC.slice(30_100))).toBe(true);
  }, 20000);
});
