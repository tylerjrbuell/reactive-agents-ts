import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { attributeFailure, analyzeCause, loadTrace } from "../src/index.js";
import { listedInputs } from "../src/attribution-facts.js";
import { uncalledClaimedTools } from "../src/tool-claim.js";

// Pins for the attribution instrument faults found by the 2026-11-06 evidence
// audit (wiki/Research/Harness-Reports/2026-11-06-evidence-wrong-output-audit.md,
// I1-I6 and the three live harness causes) and the 2026-11-06 tool-surface
// spike (D1, D2). The I-pins and the plan fan-out pin use real bench traces
// trimmed to the event kinds the classifiers read (paths rewritten); the D1/D2
// pins use hand-built synthetic traces (`synthetic-*.jsonl`, invented task text,
// ids and content) that reproduce the decisive shape. Every pin below read
// `model:had-evidence-wrong-output` (or `model:tool-protocol` / `cause=none`)
// before the fix: see wiki/Research/Harness-Reports/2026-11-06-attribution-fixes.md.

const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);
const attribute = async (name: string) => attributeFailure(await loadTrace(fixture(name)));

describe("attribution instrument faults (2026-11-06 audit)", () => {
  it("I1: a written file no failed check names is not the target (clamp.ts passed); the offer to continue is the harness cause", async () => {
    // cogito lh-debug-green 01M6RFTETPXB: wrote clamp.ts (passing), failed checks name slugify/chunk/...;
    // the final output ends "Would you like me to proceed ...?" and the exit gate accepted (seq 885).
    const a = await attribute("lh-cogito-debug-green-offer.jsonl");
    expect(a.target?.ref).not.toBe("clamp.ts");
    expect(a.reason).toBe("harness:offer-accepted-as-done");
    expect(a.confidence).toBe("decisive");
    expect(a.evidence.some((e) => e.seq === 885)).toBe(true);
  });

  it("I1: a written file a failed check names stays the target (pipeline.ts, not the passing validator.ts)", async () => {
    // cogito rw-7 01M6RFQE1SPX: hand class M1 (pipeline.ts rewritten keeping the race).
    const a = await attribute("lh-cogito-rw-7-passing-write.jsonl");
    expect(a.target?.ref).toBe("pipeline.ts");
    expect(a.reason).toBe("model:had-evidence-wrong-output");
  });

  it("I2: out-4.txt written before notes-4.txt was ever read is evidence-not-gathered, not had-evidence", async () => {
    // cogito todo-heavy 01M6Q5DEVYKN: out-4 written '10' at seq 1270 without reading notes-4.
    const a = await attribute("h3-cogito-todo-heavy-unread-input.jsonl");
    expect(a.reason).toBe("model:evidence-not-gathered");
    expect(a.confidence).toBe("decisive");
    expect(a.divergenceTurn?.seq).toBe(1270);
    expect(a.evidence.some((e) => e.detail.includes("notes-4.txt"))).toBe(true);
  });

  it("I3: one file-write running does not hide the dropped processor.ts write in the same batch", async () => {
    // qwen rw-7 01M6PY66QWK3: 3 native file-writes at seq 718, only validator.ts ran.
    const a = await attribute("h3-qwen-rw-7-batch-drop.jsonl");
    expect(a.reason).toBe("harness:tool-call-dropped");
    expect(a.evidence.some((e) => e.seq === 718 && e.detail.includes("processor.ts"))).toBe(true);
  });

  it("I4: results the projection compressed in the write turn are elided, not present", async () => {
    // cogito rw-4 01M6REK7BVNF: both http-get results compressed at seq 86 before write turn 92.
    const a = await attribute("lh-cogito-rw-4-compressed.jsonl");
    expect(a.reason).toBe("harness:evidence-truncated");
    expect(a.confidence).toBe("probable");
    expect(a.divergenceTurn?.seq).toBe(92);
  });

  it("I5: a write the repetition guard replaced wrote nothing; the first-call block is the harness cause", async () => {
    // qwen todo-heavy 01M6Q4JE73TF: file-write(out-2.txt, "84") at seq 918 replaced by
    // "already called file-write 6 times" with 1 file-write ever run; the check expects 84.
    const a = await attribute("h3-qwen-todo-heavy-blocked-writes.jsonl");
    expect(a.reason).toBe("harness:refusal-counted-as-repeat");
    expect(a.confidence).toBe("decisive");
    expect(a.divergenceTurn).toBeUndefined();
    expect(a.evidence.some((e) => e.seq === 918 && e.detail.includes("5 were tool-gate refusals"))).toBe(true);
  });

  it("I5: a first-time read the repetition guard replaced is withheld evidence (notes-3.txt)", async () => {
    // qwen todo-heavy 01M6Q2W4XTCW: file-read(notes-3.txt) at seq 1076 replaced by the notice.
    const a = await attribute("h3-qwen-todo-heavy-repeat-guard.jsonl");
    expect(a.reason).toBe("harness:refusal-counted-as-repeat");
    expect(a.evidence.some((e) => e.seq === 1076)).toBe(true);
  });

  it("I6: tool-gate refusals of every read of an input are withheld evidence", async () => {
    // qwen todo-heavy 01M6Q52V413A: reads of notes-2..6 refused (deferred-required-batch, required-first).
    const a = await attribute("h3-qwen-todo-heavy-gate-refused-reads.jsonl");
    expect(a.reason).toBe("harness:evidence-withheld");
    expect(a.evidence.some((e) => e.eventKind === "guard-fired" && e.detail.includes("required-first"))).toBe(true);
  });

  it("plan fan-out: one step result written to several files is the harness's assembly, not the model's output", async () => {
    // qwen h3-plan-only 01M6Q4Z1Z7F6: {{from_step:s2}} blob in low-stock.txt (seq 733) and summary.md (seq 736).
    const a = await attribute("h3-qwen-plan-only-fanout.jsonl");
    expect(a.reason).toBe("harness:plan-fanout-blob");
    expect(a.target?.ref).toBe("low-stock.txt");
    expect(a.evidence.map((e) => e.seq)).toEqual(expect.arrayContaining([733, 736]));
  });
});

describe("tool-surface spike faults (2026-11-06)", () => {
  it("D1: a file-write printed while the request offered no tools is harness:tool-not-offered, not model:tool-protocol", async () => {
    // Synthetic: two think turns offered no tools (toolSchemaNames []), a consecutive-thoughts
    // strategy switch between them; the second prints `{"tool": "file-write", ...}` as JSON
    // (seq 6), file-write never runs, the run abstains.
    const a = await attribute("synthetic-write-not-offered.jsonl");
    expect(a.verdict).toBe("harness");
    expect(a.reason).toBe("harness:tool-not-offered");
    expect(a.evidence.some((e) => e.seq === 6 && e.detail.includes("file-write"))).toBe(true);
    // The trace has no registry entry for builtins the opt-in dropped: probable, and says so.
    expect(a.confidence).toBe("probable");
    expect(a.missing.join(" ")).toContain("builtins opt-in");
  });

  it("D2: success with zero tool calls on a task that asked for web-search is a warning, not cause=none", async () => {
    // Synthetic: the task says "with web-search", no tool is called, and the shipped output
    // shows `web-search <url>` in a bash fence next to an answer.
    const t = await loadTrace(fixture("synthetic-tool-claim-without-call.jsonl"));
    const c = analyzeCause(t);
    expect(c.cause).toBe("success-with-warning");
    expect(c.subCause).toBe("tool-claim-without-call");
    expect(attributeFailure(t).verdict).toBe("not-failed");
  });

  it("D2 false-positive guards: `with <word>` alone, paths, history turns and called tools do not count", () => {
    expect(uncalledClaimedTools("Research trends with domain-specific benchmarks.", 0, "Done.", new Set())).toEqual([]);
    expect(uncalledClaimedTools("Write to /tmp/cortex-live-approval/x.txt", 0, "Wrote `/tmp/cortex-live-approval/x.txt`", new Set())).toEqual([]);
    const task = "User: use the session-control tool\n--- current ---\nWhat changed?";
    expect(uncalledClaimedTools(task, task.indexOf("---"), "Nothing.", new Set())).toEqual([]);
    expect(uncalledClaimedTools("Use the file-write tool to save it", 0, "Saved.", new Set(["file-write"]))).toEqual([]);
    expect(uncalledClaimedTools("Use the file-write tool to save it", 0, "Saved.", new Set())).toEqual(["file-write"]);
  });
});

describe("listedInputs", () => {
  it("reads absolute and ./ paths, expands numbered ranges, and skips conditional sentences", () => {
    const task = "Six files, /w/notes-1.txt through /w/notes-3.txt, each hold a number. Read ./ledger.json too. " +
      "Write out.txt. If the API is unavailable, check whether /w/fallback.json exists.";
    expect([...listedInputs(task)].sort()).toEqual(["ledger.json", "notes-1.txt", "notes-2.txt", "notes-3.txt"]);
  });
});
