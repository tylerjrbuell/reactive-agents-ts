// Run: bun test packages/benchmarks/tests/replay-lane.test.ts
//
// The bench:replay CI lane over the COMMITTED goldens, plus the mutation
// proofs that make the lane's green trustworthy:
//   - every committed golden replays clean (this is exactly what CI runs),
//   - a corrupted recorded response makes the lane FAIL (output mismatch),
//   - a record-side truth violation makes the lane FAIL even when the replay
//     faithfully matches the recording (garbage-golden protection).
import { describe, expect, it } from "bun:test";
import { loadRecordedRun } from "@reactive-agents/replay";
import type { RecordedRun } from "@reactive-agents/replay";
import { checkGolden, checkRecordedRun, listGoldens } from "../src/replay-lane.js";

const goldens = listGoldens();

describe("bench:replay lane — committed goldens", () => {
  it("has at least the two seed goldens committed", () => {
    expect(goldens.length).toBeGreaterThanOrEqual(2);
    const names = goldens.map((g) => g.sidecar.name);
    expect(names).toContain("answer-only");
    expect(names).toContain("tool-write");
  });

  for (const entry of goldens) {
    it(`replays clean: ${entry.sidecar.name}`, async () => {
      const res = await checkGolden(entry);
      expect(res.failures).toEqual([]);
      expect(res.ok).toBe(true);
      // The whole point of the lane: every recorded model call was consumed.
      expect(res.dispensed).toBe(res.tableSize);
    });
  }

  it("tool-write golden actually exercises the tool rail (not a text-only run in disguise)", () => {
    const toolWrite = goldens.find((g) => g.sidecar.name === "tool-write");
    expect(toolWrite).toBeDefined();
    expect(toolWrite!.sidecar.expectToolsUsed).toEqual(["file-write"]);
  });
});

describe("bench:replay lane — mutation proofs", () => {
  function corruptLastText(run: RecordedRun): RecordedRun {
    // Rewrite every recorded response's content so the replayed deliverable
    // cannot match the recording.
    const events = run.trace.events.map((e) =>
      e.kind === "llm-exchange"
        ? {
            ...e,
            response: {
              ...(e as unknown as { response: Record<string, unknown> }).response,
              content: "CORRUPTED RESPONSE — this text was never recorded",
            },
          }
        : e,
    );
    return { ...run, trace: { ...run.trace, events } } as RecordedRun;
  }

  it("fails on a corrupted recorded response", async () => {
    const entry = goldens.find((g) => g.sidecar.name === "answer-only")!;
    const run = corruptLastText(await loadRecordedRun(entry.goldenPath));
    const res = await checkRecordedRun(run, entry.sidecar);
    expect(res.ok).toBe(false);
    expect(res.failures.join("\n")).toContain("record-side truth failed");
  });

  it("fails when record-side truth is violated even if replay matches the recording", async () => {
    const entry = goldens.find((g) => g.sidecar.name === "answer-only")!;
    const run = await loadRecordedRun(entry.goldenPath);
    const res = await checkRecordedRun(run, {
      ...entry.sidecar,
      expectOutputIncludes: ["THIS SENTINEL IS NOT IN THE DELIVERABLE"],
    });
    expect(res.ok).toBe(false);
    expect(res.failures.join("\n")).toContain("record-side truth failed");
  });
});
