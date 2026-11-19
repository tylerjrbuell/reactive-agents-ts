// Run: bun run repo test packages/benchmarks/tests/sim/shape-pending-write.test.ts
// Shape 9: read 1, write 1, read 2, re-read 2 (refused). The refusal must lead with the pending write. Zero tokens.
import { describe, expect, it } from "bun:test";
import { armConfig } from "../../src/sim/mechanisms.js";
import { kernelProvenance, formatKernelProvenance } from "./provenance.js";
import { NOTES, pendingWrite, pendingWriteStubbornCap14, pendingWriteStubbornCap16 } from "../../src/sim/shapes/pending-write.js";
import type { Shape } from "../../src/sim/shape.js";
import { runArm } from "./run-shape.js";

const pendingWriteBase: Shape = pendingWrite;

/** The shape with its write tool recording (path -> content) and its policy capturing the turn-4 request text. */
function instrumented(pendingWrite: Shape = pendingWriteBase): { shape: Shape; writes: Map<string, string>; refusalSeen: string[] } {
  const writes = new Map<string, string>();
  const refusalSeen: string[] = [];
  const tools = pendingWrite.tools.map((t) =>
    t.name !== "file-write"
      ? t
      : { ...t, run: (args: Readonly<Record<string, unknown>>, i: number) => {
          writes.set(String(args.path).split("/").pop() ?? "",String(args.content));
          return t.run(args, i);
        } },
  );
  const policy: Shape["policy"] = (req, ctx) => {
    if (ctx.agentTurn === 4) {
      refusalSeen.push(req.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n"));
    }
    return pendingWrite.policy(req, ctx);
  };
  return { shape: { ...pendingWrite, tools, policy }, writes, refusalSeen };
}

describe("shape 9: pending write after a refused re-read", () => {
  it("records which kernel source the sim resolved (provenance)", () => {
    const line = formatKernelProvenance(kernelProvenance());
    console.log(line);
    expect(line).toContain("packages/reasoning/src");
  });

  it("refusal leads with the write; a policy that writes next solves, all six outputs exact", async () => {
    const { shape, writes, refusalSeen } = instrumented();
    const r = await runArm(shape, armConfig());
    const refusal = /\[Already done[^\]]*\]/.exec(refusalSeen[0] ?? "")?.[0] ?? "";
    expect(refusal).toMatch(/Write \S*out-2\.txt now from the value you just read in \S*notes-2\.txt/);
    expect(refusal.indexOf("Write")).toBeLessThan(refusal.indexOf("Read notes-3") === -1 ? Infinity : refusal.indexOf("Read notes-3"));
    expect(refusal).toContain("Then read");
    expect(r.toolSeq).toEqual(pendingWrite.ideal.toolSeq);
    for (let i = 0; i < NOTES.length; i++) expect(writes.get(`out-${i + 1}.txt`)).toBe(String(NOTES[i]! * 2));
    expect(r.meetsIdeal).toBe(true);
  }, 30000);

  // Live addendum 6: 5 of 8 refusal runs re-read twice before writing; 3 hit the 14-iteration cap with correct values.
  it("stubborn model (two refused re-reads): completes at cap 16, loses the last pair at the live cap 14 (cause E, known open)", async () => {
    const wide = instrumented(pendingWriteStubbornCap16);
    await runArm(wide.shape, armConfig());
    for (let i = 0; i < NOTES.length; i++) expect(wide.writes.get(`out-${i + 1}.txt`)).toBe(String(NOTES[i]! * 2));
    const live = instrumented(pendingWriteStubbornCap14);
    await runArm(live.shape, armConfig());
    expect(live.writes.get("out-2.txt")).toBe(String(NOTES[1]! * 2)); // the hint worked: out-2 is right
    expect(live.writes.has("out-6.txt")).toBe(false); // the budget did not
  }, 30000);
});
