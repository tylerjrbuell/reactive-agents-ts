import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { attributeFailure, loadTrace } from "../src/index.js";

// Regression over trimmed real H3 traces (2026-11-03 corpus, qwen3:4b and
// cogito:8b on ollama). Trimmed to the event kinds attribution reads, with the
// repo path rewritten to /repo. Each label below was hand-checked against the
// full trace (seq numbers are the original ones).

const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);

describe("attributeFailure — real H3 traces", () => {
  it("cogito h3-required-tools run0: the CSV was in the request and the written mean is wrong (model)", async () => {
    const a = attributeFailure(await loadTrace(fixture("h3-cogito-required-tools-run0.jsonl")));
    expect(a.verdict).toBe("model");
    expect(a.reason).toBe("model:had-evidence-wrong-output");
    expect(a.confidence).toBe("decisive");
    // Turn seq 1226 wrote mean.txt=20.48; file-read#1215 (the CSV) is in its request.
    expect(a.divergenceTurn).toEqual({ iter: 3, seq: 1226 });
    expect(a.target?.ref).toBe("mean.txt");
    expect(a.evidence.some((e) => e.seq === 1215)).toBe(true);
  });

  it("cogito h3-exact-value run1: the printed call was parsed into an object-literal path, then the run abstained (harness)", async () => {
    const a = attributeFailure(await loadTrace(fixture("h3-cogito-exact-value-run1.jsonl")));
    expect(a.verdict).toBe("harness");
    expect(a.reason).toBe("harness:tool-call-corrupted");
    expect(a.confidence).toBe("decisive");
    expect(a.evidence.some((e) => e.seq === 3122 && e.detail.includes("object-literal"))).toBe(true);
  });

  it("qwen rw-2 run0: the native file-write for analysis.md was dropped by a strategy switch (harness)", async () => {
    const a = attributeFailure(await loadTrace(fixture("h3-qwen-rw-2-run0.jsonl")));
    expect(a.verdict).toBe("harness");
    expect(a.reason).toBe("harness:tool-call-dropped");
    expect(a.divergenceTurn).toEqual({ iter: 3, seq: 87 });
    expect(a.target?.ref).toBe("analysis.md");
    expect(a.evidence.some((e) => e.eventKind === "strategy-switched" && e.seq === 95)).toBe(true);
  });

  it("is deterministic: the same trace yields the same attribution", async () => {
    const t = await loadTrace(fixture("h3-qwen-rw-2-run0.jsonl"));
    expect(attributeFailure(t)).toEqual(attributeFailure(t));
  });
});
