import { describe, it, expect } from "bun:test";
import { attributeFailure } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import { urlTokens } from "../src/attribution-containment.js";
import { unescapedLiteralNewlines } from "../src/attribution-literal-newlines.js";
import { mk } from "./fixtures/mk-event.js";

// Pins for the tool-result budget spike (wiki/Research/Harness-Reports/2026-11-07-tool-result-budget-spike.md, F3):
// `harness:evidence-truncated` fired on any cut result and was wrong on 6 of 6
// lh-1 runs: the URLs the deliverables used were visible on the turn that wrote
// them, and 5 of the 6 wrote prose files as one line of literal `\n`.
// Synthetic traces only: invented task, URLs and content that reproduce the
// recorded shape (a compressed web-search preview, then a sources file write).

let seq = 0;
const at = (iter: number) => ({ runId: "synth", iter, seq: seq++, timestamp: 1000 + seq });
const trace = (events: TraceEvent[]): Trace => ({ runId: "synth", events });

const TASK = "Research the topic and write sources.md listing every source URL you cite.";
const started = () => mk({ ...at(-1), kind: "run-started", task: TASK, model: "m", provider: "ollama", config: {} });
const search = (iter: number, result: string) => [
  mk({ ...at(iter), kind: "tool-call-start", toolName: "web-search" }),
  mk({ ...at(iter), kind: "tool-call-end", toolName: "web-search", args: { query: "topic" }, ok: true, result }),
];
const writeTurn = (iter: number, request: string, content: string, opts: { truncated?: boolean; path?: string } = {}) => {
  const path = opts.path ?? "./sources.md";
  return [
    mk({
      ...at(iter), kind: "llm-exchange", provider: "ollama", model: "m", requestKind: "stream", purpose: "think",
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: TASK }, { role: "tool", content: request, ...(opts.truncated ? { truncated: true } : {}) }],
      toolSchemaNames: ["web-search", "file-write"],
      response: { content: "", toolCalls: [{ name: "file-write", arguments: { path, content } }] },
    }),
    mk({ ...at(iter), kind: "tool-call-start", toolName: "file-write" }),
    mk({ ...at(iter), kind: "tool-call-end", toolName: "file-write", args: { path: `/w/${path.slice(2)}`, content }, ok: true, result: "✓ Written" }),
  ];
};
const completed = () =>
  mk({
    ...at(-1), kind: "run-completed", status: "success", terminatedBy: "end_turn", totalTokens: 1, totalCostUsd: 0, durationMs: 1,
    outcome: { status: "completed", success: true, terminatedBy: "end_turn", provenance: "model-final", verdict: null, answerSatisfied: null },
  });
const graded = (file = "sources.md") =>
  mk({ ...at(-1), kind: "eval-graded", score: 0.5, passed: false, threshold: 1, checks: [{ name: `${file} lists at least 6 distinct source URLs`, passed: false }], grader: "verifiable", taskId: "t1" });

// A compressed preview: two hits shown, the rest elided.
const PREVIEW = "[web-search result — compressed preview]\n1. Overview https://docs.example.org/overview\n2. Guide https://docs.example.org/guide\n  ...12 more lines";

describe("containment gates harness:evidence-truncated", () => {
  it("every URL the deliverable uses is visible on its turn: not truncated, the model owns it (probable)", () => {
    const a = attributeFailure(trace([
      started(), ...search(0, PREVIEW),
      ...writeTurn(1, PREVIEW, "# Sources\n- https://docs.example.org/overview\n- https://docs.example.org/guide"),
      completed(), graded(),
    ]));
    expect(a.reason).toBe("model:had-evidence-wrong-output");
    expect(a.confidence).toBe("probable");
    expect(a.alsoMatched).not.toContain("harness:evidence-truncated");
    expect(a.missing.join(" ")).toContain("cut part");
    expect(a.evidence.some((e) => e.detail.includes("2/2 URL(s) the deliverable uses are visible"))).toBe(true);
  });

  it("a miscopied URL (in no recorded result) does not keep the cut in play", () => {
    const a = attributeFailure(trace([
      started(), ...search(0, PREVIEW),
      ...writeTurn(1, PREVIEW, "# Sources\n- https://docs.example.org/overview\n- https://docs.exampel.org/guide"),
      completed(), graded(),
    ]));
    expect(a.reason).toBe("model:had-evidence-wrong-output");
    expect(a.evidence.some((e) => e.detail.includes("1 in no recorded result (https://docs.exampel.org/guide)"))).toBe(true);
  });

  it("a deliverable URL held by a cut result but not the clipped request keeps the rule, probable, naming the recorder cap", () => {
    const raw = "1. Overview https://docs.example.org/overview\n2. Guide https://docs.example.org/guide\n3. Deep dive https://docs.example.org/deep";
    const shown = "1. Overview https://docs.example.org/overview\n2. Guide https://docs.example.org/guide";
    const a = attributeFailure(trace([
      started(), ...search(0, raw),
      mk({ ...at(1), kind: "projection-rendered", sections: ["evidence"], refs: [], droppedRefs: [], chars: 100, compressions: [{ tool: "web-search", rawChars: raw.length, shownChars: shown.length }] }),
      ...writeTurn(1, shown, "# Sources\n- https://docs.example.org/overview\n- https://docs.example.org/deep", { truncated: true }),
      completed(), graded(),
    ]));
    expect(a.reason).toBe("harness:evidence-truncated");
    expect(a.confidence).toBe("probable");
    expect(a.missing.join(" ")).toContain("recorder caps each message");
  });

  it("a deliverable with no URL keeps the old reading (the existing truncation pins hold)", () => {
    const a = attributeFailure(trace([
      started(), ...search(0, PREVIEW),
      ...writeTurn(1, PREVIEW, "# Sources\nthe official docs and the guide"),
      completed(), graded(),
    ]));
    expect(a.reason).toBe("harness:evidence-truncated");
    expect(a.missing.join(" ")).toContain("holds no URL");
  });

  it("evidence-missing is cleared the same way: the absent result held nothing the deliverable used", () => {
    const listed = "Use https://docs.example.org/overview and https://docs.example.org/guide.";
    const a = attributeFailure(trace([
      started(), ...search(0, "1. Unrelated https://other.example.net/page\n2. Also unrelated https://other.example.net/two"),
      ...writeTurn(1, listed, "# Sources\n- https://docs.example.org/overview\n- https://docs.example.org/guide"),
      completed(), graded(),
    ]));
    expect(a.reason).not.toBe("harness:evidence-missing");
    expect(a.reason).toBe("model:had-evidence-wrong-output");
  });
});

describe("harness:unrepaired-content (literal \\n in a prose deliverable)", () => {
  // Bare URL lines, as the lh-1 runs wrote them: joined by literal \n they read as one URL.
  const ONE_LINE = "# Sources\\nhttps://docs.example.org/overview\\nhttps://docs.example.org/guide";

  it("a sources.md written as one line of literal \\n is the harness's, probable, before the evidence rules", () => {
    const a = attributeFailure(trace([
      started(), ...search(0, PREVIEW), ...writeTurn(1, PREVIEW, ONE_LINE), completed(), graded(),
    ]));
    expect(a.reason).toBe("harness:unrepaired-content");
    expect(a.verdict).toBe("harness");
    expect(a.confidence).toBe("probable");
    expect(a.target?.ref).toBe("sources.md");
    expect(a.evidence[0]!.detail).toContain("2 literal \\n");
    expect(a.evidence[0]!.detail).toContain("reads 1 URL(s) as written, 2 after");
    expect(a.alsoMatched).toContain("model:had-evidence-wrong-output");
    expect(a.missing.join(" ")).toContain("regrade");
  });

  it("does not fire on a file with a real newline, a single literal \\n, or a .json path", () => {
    const real = attributeFailure(trace([started(), ...search(0, PREVIEW), ...writeTurn(1, PREVIEW, "# Sources\\n- a\n- b\\n"), completed(), graded()]));
    expect(real.reason).not.toBe("harness:unrepaired-content");
    const single = attributeFailure(trace([started(), ...search(0, PREVIEW), ...writeTurn(1, PREVIEW, "# Sources\\n- https://docs.example.org/overview"), completed(), graded()]));
    expect(single.reason).not.toBe("harness:unrepaired-content");
    const json = attributeFailure(trace([started(), ...search(0, PREVIEW), ...writeTurn(1, PREVIEW, ONE_LINE, { path: "./sources.json" }), completed(), graded("sources.json")]));
    expect(json.reason).not.toBe("harness:unrepaired-content");
  });

  it("unescapedLiteralNewlines keeps escaped backslashes and requires two literal \\n", () => {
    expect(unescapedLiteralNewlines("a\\nb\\nc \\\\n")).toBe("a\nb\nc \\\\n");
    expect(unescapedLiteralNewlines("a\\nb")).toBeUndefined();
    expect(unescapedLiteralNewlines("a\\nb\\nc\nreal")).toBeUndefined();
  });

  it("urlTokens ends a token at a backslash, an ellipsis and trailing punctuation", () => {
    expect(urlTokens("see https://a.example/x.\\nhttps://b.example/y, https://githu… end")).toEqual(["https://a.example/x", "https://b.example/y", "https://githu"]);
  });
});
