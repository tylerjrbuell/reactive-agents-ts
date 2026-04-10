// File: tests/strategies/kernel/utils/output-synthesis.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  validateOutputFormat,
  buildFinalAnswerCandidate,
  finalizeOutput,
  type FinalAnswerCandidate,
} from "../../../../src/strategies/kernel/utils/output-synthesis.js";
import type { TaskIntent } from "../../../../src/strategies/kernel/utils/task-intent.js";

// ── validateOutputFormat ─────────────────────────────────────────────────────

describe("validateOutputFormat", () => {
  it("passes when format is null (no specific request)", () => {
    const result = validateOutputFormat("any random text", null);
    expect(result.valid).toBe(true);
  });

  // ── markdown ──

  it("validates markdown: passes with table (pipe and divider)", () => {
    const table = "| Name | Price |\n|------|-------|\n| BTC | 50000 |";
    expect(validateOutputFormat(table, "markdown").valid).toBe(true);
  });

  it("validates markdown: passes with headings", () => {
    expect(validateOutputFormat("# Title\n\nSome content", "markdown").valid).toBe(true);
  });

  it("validates markdown: passes with bold text", () => {
    expect(validateOutputFormat("This is **bold** text", "markdown").valid).toBe(true);
  });

  it("validates markdown: passes with bullet list", () => {
    expect(validateOutputFormat("- Item 1\n- Item 2", "markdown").valid).toBe(true);
  });

  it("validates markdown: passes with code fence", () => {
    expect(validateOutputFormat("```js\nconsole.log('hi')\n```", "markdown").valid).toBe(true);
  });

  it("validates markdown: fails with plain text (no formatting)", () => {
    expect(validateOutputFormat("just some text", "markdown").valid).toBe(false);
  });

  it("validates markdown: fails with plain text containing pipes but no divider", () => {
    expect(validateOutputFormat("| col1 | col2 |\nno divider", "markdown").valid).toBe(false);
  });

  // ── json ──

  it("validates json: passes with valid JSON object", () => {
    expect(validateOutputFormat('{"key": "value"}', "json").valid).toBe(true);
  });

  it("validates json: passes with valid JSON array", () => {
    expect(validateOutputFormat('[1, 2, 3]', "json").valid).toBe(true);
  });

  it("validates json: fails with invalid JSON", () => {
    expect(validateOutputFormat("not json at all", "json").valid).toBe(false);
  });

  it("validates json: passes with JSON in code fence", () => {
    const fenced = '```json\n{"key": "value"}\n```';
    expect(validateOutputFormat(fenced, "json").valid).toBe(true);
  });

  // ── csv ──

  it("validates csv: passes with comma-separated rows", () => {
    const csv = "name,price,volume\nBTC,50000,1000\nETH,3000,500";
    expect(validateOutputFormat(csv, "csv").valid).toBe(true);
  });

  it("validates csv: fails without commas", () => {
    expect(validateOutputFormat("no commas here", "csv").valid).toBe(false);
  });

  // ── html ──

  it("validates html: passes with HTML tags", () => {
    expect(validateOutputFormat("<div>Hello</div>", "html").valid).toBe(true);
  });

  it("validates html: fails without HTML tags", () => {
    expect(validateOutputFormat("plain text", "html").valid).toBe(false);
  });

  // ── code ──

  it("validates code: passes with code fence", () => {
    expect(validateOutputFormat("```python\nprint('hello')\n```", "code").valid).toBe(true);
  });

  it("validates code: passes with function/def keyword", () => {
    expect(validateOutputFormat("def sort_list(items):\n  return sorted(items)", "code").valid).toBe(true);
  });

  it("validates code: fails with plain text", () => {
    expect(validateOutputFormat("just some explanation", "code").valid).toBe(false);
  });

  // ── list ──

  it("validates list: passes with bullet points", () => {
    expect(validateOutputFormat("- Item 1\n- Item 2\n- Item 3", "list").valid).toBe(true);
  });

  it("validates list: passes with numbered items", () => {
    expect(validateOutputFormat("1. First\n2. Second\n3. Third", "list").valid).toBe(true);
  });

  it("validates list: fails with plain text", () => {
    expect(validateOutputFormat("just a paragraph of text", "list").valid).toBe(false);
  });

  // ── prose ──

  it("validates prose: always passes (any text is valid)", () => {
    expect(validateOutputFormat("anything goes here", "prose").valid).toBe(true);
  });

  // ── reason codes ──

  it("returns a reason when validation fails", () => {
    const result = validateOutputFormat("no table", "markdown");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});

// ── buildFinalAnswerCandidate ────────────────────────────────────────────────

describe("buildFinalAnswerCandidate", () => {
  it("builds with source and format hint", () => {
    const intent: TaskIntent = { format: "markdown", cues: ["table"], expectedContent: ["prices"] };
    const candidate = buildFinalAnswerCandidate("raw output", "harness", intent);
    expect(candidate.output).toBe("raw output");
    expect(candidate.source).toBe("harness");
    expect(candidate.formatHint).toBe("markdown");
  });

  it("builds with null format when no intent", () => {
    const intent: TaskIntent = { format: null, cues: [], expectedContent: [] };
    const candidate = buildFinalAnswerCandidate("output", "model", intent);
    expect(candidate.formatHint).toBeNull();
  });
});

// ── finalizeOutput ───────────────────────────────────────────────────────────

describe("finalizeOutput", () => {
  const noFormatIntent: TaskIntent = { format: null, cues: [], expectedContent: [] };
  const tableIntent: TaskIntent = { format: "markdown", cues: ["markdown table"], expectedContent: ["prices"] };

  it("passes output through unchanged when no format is requested", () => {
    const candidate: FinalAnswerCandidate = {
      output: "some answer text",
      formatHint: null,
      source: "model",
    };
    const result = Effect.runSync(
      finalizeOutput(candidate, noFormatIntent, "What is 2+2?"),
    );
    expect(result.output).toBe("some answer text");
    expect(result.formatValidated).toBe(true);
    expect(result.synthesized).toBe(false);
  });

  it("passes output through when format already matches", () => {
    const table = "| Name | Price |\n|------|-------|\n| BTC | 50000 |";
    const candidate: FinalAnswerCandidate = {
      output: table,
      formatHint: "markdown",
      source: "model",
    };
    const result = Effect.runSync(
      finalizeOutput(candidate, tableIntent, "create a table"),
    );
    expect(result.output).toBe(table);
    expect(result.formatValidated).toBe(true);
    expect(result.synthesized).toBe(false);
  });

  it("marks formatValidated=false when format does not match and no LLM available", () => {
    const candidate: FinalAnswerCandidate = {
      output: "raw web search results with no table",
      formatHint: "markdown",
      source: "harness",
    };
    // Without LLMService, finalizeOutput should still succeed but mark as not validated
    const result = Effect.runSync(
      finalizeOutput(candidate, tableIntent, "create a table"),
    );
    expect(result.formatValidated).toBe(false);
    expect(result.synthesized).toBe(false);
    // Output should still be returned (degraded but not lost)
    expect(result.output).toBe("raw web search results with no table");
  });

  it("preserves source metadata", () => {
    const candidate: FinalAnswerCandidate = {
      output: "answer",
      formatHint: null,
      source: "oracle",
    };
    const result = Effect.runSync(
      finalizeOutput(candidate, noFormatIntent, "task"),
    );
    expect(result.source).toBe("oracle");
  });

  it("forces synthesis for harness-source output even without explicit format", () => {
    const candidate: FinalAnswerCandidate = {
      output: "[web-search result]\n1. Some raw tool data",
      formatHint: null,
      source: "harness",
    };
    const result = Effect.runSync(
      finalizeOutput(candidate, noFormatIntent, "what is the price?"),
    );
    expect(result.formatValidated).toBe(false);
    expect(result.validationReason).toContain("harness");
  });

  it("forces synthesis for oracle-source output even without explicit format", () => {
    const candidate: FinalAnswerCandidate = {
      output: "raw tool artifacts from oracle",
      formatHint: null,
      source: "oracle",
    };
    const result = Effect.runSync(
      finalizeOutput(candidate, noFormatIntent, "task"),
    );
    expect(result.formatValidated).toBe(false);
    expect(result.validationReason).toContain("oracle");
  });

  it("passes through model-source output when no format requested", () => {
    const candidate: FinalAnswerCandidate = {
      output: "The answer is 42.",
      formatHint: null,
      source: "model",
    };
    const result = Effect.runSync(
      finalizeOutput(candidate, noFormatIntent, "What is the meaning?"),
    );
    expect(result.formatValidated).toBe(true);
    expect(result.source).toBe("model");
  });
});
