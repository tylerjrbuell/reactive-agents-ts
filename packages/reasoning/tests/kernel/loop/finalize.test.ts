// File: tests/kernel/loop/finalize.test.ts
/**
 * Invariant + drift-prevention tests for the shared synthesis quality gate.
 *
 * Phase 0 contract: reflexion and plan-execute consume `enforceQualityGate` /
 * `collectToolData` / `decideSynthesisInput` from `kernel/loop/finalize.ts`.
 * Drift is prevented at three levels:
 *   1. Pure-decision tests (decideSynthesisInput) — the core branching rules.
 *   2. Harvest tests (collectToolData) — KernelMessage filtering invariants.
 *   3. Drift-prevention contract test — grep-enforced: no strategies/*.ts file
 *      may re-import the underlying synthesis primitives directly. All routes
 *      must go through finalize.ts.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  decideSynthesisInput,
  collectToolData,
  enforceQualityGate,
} from "../../../src/kernel/loop/finalize.js";
import type { KernelMessage } from "../../../src/kernel/state/kernel-state.js";

// ── 1. decideSynthesisInput — pure decision rules ────────────────────────────

describe("decideSynthesisInput", () => {
  it("skips synthesis when no format requested", () => {
    const r = decideSynthesisInput("Some text answer.", "Explain X.", undefined);
    expect(r.needsSynthesis).toBe(false);
    expect(r.rawForSynthesis).toBe("Some text answer.");
  });

  it("skips synthesis when output is format-valid AND content-complete", () => {
    const task = "Get the price for BTC. Return a markdown table.";
    const completeOutput = "| Coin | Price |\n| --- | --- |\n| BTC | $77,000.00 |";
    const r = decideSynthesisInput(completeOutput, task, "raw tool data");
    expect(r.needsSynthesis).toBe(false);
  });

  it("triggers synthesis on placeholder-laden markdown (the bug fix)", () => {
    const task = "Search the web for the latest news for XRP and Bitcoin and get live prices, then write a report in markdown format.";
    const placeholderDraft =
      "## Report\n\n| Coin | Price |\n| --- | --- |\n| BTC | [Insert BTC Price Here] |\n| XRP | [Insert XRP Price Here] |";
    const toolData =
      '[crypto-price] {"prices":[{"symbol":"BTC","price":77009},{"symbol":"XRP","price":1.35}]}';

    const r = decideSynthesisInput(placeholderDraft, task, toolData);
    expect(r.needsSynthesis).toBe(true);
    expect(r.rawForSynthesis).toBe(toolData);
    expect(r.rawForSynthesis).not.toContain("[Insert BTC Price Here]");
  });

  it("falls back to draft when synthesis needed but no tool data exists", () => {
    const task = "Explain quantum entanglement in markdown.";
    const draft = "quantum entanglement is when particles are linked";
    const r = decideSynthesisInput(draft, task, undefined);
    expect(r.needsSynthesis).toBe(true);
    expect(r.rawForSynthesis).toBe(draft);
  });

  it("prefers tool data over draft even for invalid-format output", () => {
    const task = "Get crypto prices and format as markdown.";
    const draft = "no markdown here just plain text";
    const toolData = '[crypto-price] {"BTC":77009}';
    const r = decideSynthesisInput(draft, task, toolData);
    expect(r.needsSynthesis).toBe(true);
    expect(r.rawForSynthesis).toBe(toolData);
  });

  it("treats empty tool data string as absent (falls back to draft)", () => {
    const task = "Get the price for BTC and XRP and return it in markdown format.";
    const draft = "# Report\n\nBTC: [placeholder]";
    const r = decideSynthesisInput(draft, task, "");
    expect(r.needsSynthesis).toBe(true);
    expect(r.rawForSynthesis).toBe(draft);
  });
});

// ── 2. collectToolData — KernelMessage filtering ─────────────────────────────

describe("collectToolData", () => {
  it("returns empty string for empty messages", () => {
    expect(collectToolData([])).toBe("");
  });

  it("extracts only tool_result messages (drops assistant/user)", () => {
    const msgs: readonly KernelMessage[] = [
      { role: "user", content: "find BTC price" },
      { role: "assistant", content: "calling tool" },
      { role: "tool_result", toolCallId: "1", toolName: "crypto", content: "BTC=77000" },
      { role: "assistant", content: "done" },
    ];
    expect(collectToolData(msgs)).toBe("[crypto] BTC=77000");
  });

  it("skips errored tool_results so synthesis never sees failure noise", () => {
    const msgs: readonly KernelMessage[] = [
      { role: "tool_result", toolCallId: "1", toolName: "ok", content: "value" },
      { role: "tool_result", toolCallId: "2", toolName: "bad", content: "404", isError: true },
    ];
    expect(collectToolData(msgs)).toBe("[ok] value");
  });

  it("preserves message order in output", () => {
    const msgs: readonly KernelMessage[] = [
      { role: "tool_result", toolCallId: "1", toolName: "first", content: "A" },
      { role: "tool_result", toolCallId: "2", toolName: "second", content: "B" },
      { role: "tool_result", toolCallId: "3", toolName: "third", content: "C" },
    ];
    expect(collectToolData(msgs)).toBe("[first] A\n[second] B\n[third] C");
  });

  it("skips empty-content tool_results", () => {
    const msgs: readonly KernelMessage[] = [
      { role: "tool_result", toolCallId: "1", toolName: "empty", content: "" },
      { role: "tool_result", toolCallId: "2", toolName: "ok", content: "X" },
    ];
    expect(collectToolData(msgs)).toBe("[ok] X");
  });
});

// ── 3. enforceQualityGate — Effect wrapper, no-op + fallback invariants ──────

const runGate = (input: {
  taskDescription: string;
  output: string;
  toolData?: string;
  llmTurns: { text: string }[];
}) => {
  const layer = TestLLMServiceLayer(input.llmTurns);
  const program = Effect.gen(function* () {
    const llm = yield* LLMService;
    return yield* enforceQualityGate({
      llm,
      taskDescription: input.taskDescription,
      output: input.output,
      toolData: input.toolData,
    });
  }).pipe(Effect.provide(layer));
  return Effect.runPromise(program);
};

describe("enforceQualityGate", () => {
  it("no-op when no format detected (zero LLM cost)", async () => {
    const r = await runGate({
      taskDescription: "Explain X.",
      output: "free-form answer",
      llmTurns: [{ text: "should-not-be-called" }],
    });
    expect(r.output).toBe("free-form answer");
    expect(r.tokens).toBe(0);
    expect(r.cost).toBe(0);
  });

  it("no-op when output is format-valid AND content-complete", async () => {
    const r = await runGate({
      taskDescription: "Get BTC price. Return markdown table.",
      output: "| Coin | Price |\n| --- | --- |\n| BTC | $77,000.00 |",
      toolData: "[crypto] BTC=77000",
      llmTurns: [{ text: "should-not-be-called" }],
    });
    expect(r.tokens).toBe(0);
  });

  it("falls back to original draft when synthesis returns empty", async () => {
    const draft = "# Report\n\nBTC: [placeholder]";
    const r = await runGate({
      taskDescription: "Get the price for BTC and XRP and return in markdown format.",
      output: draft,
      toolData: "[crypto] BTC=77000 XRP=1.35",
      llmTurns: [{ text: "" }],
    });
    expect(r.output).toBe(draft);
  });
});

// ── 4. DRIFT-PREVENTION (E2) — strategies must route through finalize.ts ─────

describe("drift contract", () => {
  it("no strategies/*.ts file imports synthesis primitives directly", () => {
    const stratDir = join(__dirname, "../../../src/strategies");
    const files = readdirSync(stratDir).filter((f) => f.endsWith(".ts"));
    const banned = [
      "buildSynthesisPrompt",
      "validateContentCompleteness",
    ];
    const violations: { file: string; symbol: string }[] = [];

    for (const file of files) {
      const src = readFileSync(join(stratDir, file), "utf8");
      const importBlocks = src.match(/^import[\s\S]+?from\s+["'][^"']+["'];?$/gm) ?? [];
      for (const block of importBlocks) {
        // Allow imports from finalize.ts (the canonical source).
        if (/finalize\.js/.test(block)) continue;
        for (const sym of banned) {
          // Match symbol as a named import token (boundary on either side).
          const re = new RegExp(`[{,\\s]${sym}\\b`);
          if (re.test(block)) violations.push({ file, symbol: sym });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}: imports ${v.symbol} directly (must come from kernel/loop/finalize.js)`)
        .join("\n");
      throw new Error(
        `Drift contract violated — synthesis primitives must route through finalize.ts:\n${msg}`,
      );
    }
    expect(violations.length).toBe(0);
  });

  it("strategies that consume the gate use enforceQualityGate (not local re-implementations)", () => {
    const stratDir = join(__dirname, "../../../src/strategies");
    const files = readdirSync(stratDir).filter((f) => f.endsWith(".ts"));
    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(join(stratDir, file), "utf8");
      // A strategy that DEFINES its own enforceQualityGate / enforceOutputQualityGate
      // function (rather than importing one) is the drift class we want to catch.
      if (/^\s*function\s+enforce(Output)?QualityGate\s*\(/m.test(src)) {
        violations.push(file);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Strategy re-implemented the quality gate locally: ${violations.join(", ")}. ` +
          `Import from kernel/loop/finalize.ts instead.`,
      );
    }
    expect(violations.length).toBe(0);
  });
});
