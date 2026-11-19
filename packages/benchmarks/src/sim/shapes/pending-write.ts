/**
 * Shape 9: the pending write (h3-todo-heavy, cause A). The model reads notes-2,
 * does NOT write out-2, and re-reads notes-2. The duplicate guard refuses the
 * re-read; what the refusal LEADS with decides the rest of the run. "Read notes-3
 * first" shifted every later output by one (6 of 10 cogito:8b runs); "Write out-2
 * now from the value you just read" lets the model carry on in order.
 *
 * The policy follows the first imperative of the latest refusal, as the live model
 * did (trace seq 116: its very next call was the read the hint named).
 *
 * Source: zoo-live addendum 5 (2026-11-18), cogito:8b h3-todo-heavy 0/10, cause A;
 * fix 132ae5515 (duplicate refusal leads with the pending write).
 */
import type { PolicyModel } from "../policy-model.js";
import type { Shape, ShapeTool } from "../shape.js";

export const NOTES: readonly number[] = [17, 42, 8, 63, 29, 54];

const TASK =
  "Six files in your working directory, notes-1.txt through notes-6.txt, each contain one integer. " +
  "Track the work as a todo list with one item per file. For each notes-N.txt, write out-N.txt " +
  "containing exactly double that integer (digits only). Finish all six.";

const read = (n: number) => ({ toolCall: { id: `r${n}`, name: "file-read", args: { path: `notes-${n}.txt` } } });
const write = (n: number, value: number) => ({
  toolCall: { id: `w${n}`, name: "file-write", args: { path: `out-${n}.txt`, content: String(value) } },
});

/** Text of the most recent duplicate-refusal note in the request, or "". */
const lastRefusal = (text: string): string => {
  const hits = [...text.matchAll(/\[Already done[^\]]*\]/g)];
  return hits.length === 0 ? "" : (hits[hits.length - 1]?.[0] ?? "");
};

/**
 * Turns 0-3: read 1, write out-1, read 2, re-read 2 (the stall). Turn 4 obeys the
 * refusal's first imperative: Write -> out-2 then the remaining pairs in order; Read
 * notes-3 -> the off-by-one lag (out-2 gets notes-3's double, then it gives up).
 */
const policyWith = (rereads: number): PolicyModel => (req, ctx) => {
  const seen = req.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  // Each extra refused re-read pushes every later turn back by one.
  const extra = rereads - 1;
  if (ctx.agentTurn >= 3 && ctx.agentTurn <= 3 + extra) return read(2);
  const t = ctx.agentTurn > 3 + extra ? ctx.agentTurn - extra : ctx.agentTurn;
  if (t === 0) return read(1);
  if (t === 1) return write(1, NOTES[0]! * 2);
  if (t === 2) return read(2);
  if (t === 3) return read(2);
  const refusal = lastRefusal(seen);
  const leadsWithWrite = /Do the next item now\.\s*Write\b|Not done yet\.\s*Write\b/.test(refusal);
  if (leadsWithWrite) {
    // t=4 write out-2, then read n / write out-n for n = 3..6, then answer.
    if (t === 4) return write(2, NOTES[1]! * 2);
    const k = t - 5; // 0-based over the 8 remaining tool turns
    if (k < 8) {
      const n = 3 + Math.floor(k / 2);
      return k % 2 === 0 ? read(n) : write(n, NOTES[n - 1]! * 2);
    }
    return { text: "All six files written." };
  }
  // Lag path: follows "Read notes-3 first", then writes the wrong value into out-2.
  if (t === 4) return read(3);
  if (t === 5) return write(2, NOTES[2]! * 2);
  return { text: "Done." };
};

const tools: readonly ShapeTool[] = [
  {
    name: "file-read",
    description: "Read a file.",
    parameters: [{ name: "path", type: "string", required: true }],
    run: (args) => {
      const m = /notes-(\d)\.txt/.exec(String(args.path ?? ""));
      const n = m === null ? 0 : Number(m[1]);
      return n >= 1 && n <= 6 ? { ok: true, result: String(NOTES[n - 1]) } : { ok: false, error: "ENOENT" };
    },
  },
  {
    name: "file-write",
    description: "Write a file.",
    parameters: [
      { name: "path", type: "string", required: true },
      { name: "content", type: "string", required: true },
    ],
    run: () => ({ ok: true, result: "written" }),
  },
];

/** Same situation; the model re-reads notes-2 `rereads` times before it obeys the refusal (live: 1 or 2). */
const base = (id: string, rereads: number, maxIterations: number): Shape => ({
  id,
  sourceTraceId: "zoo-live addendum 6 (2026-11-18): cogito:8b h3-todo-heavy 1/10; 5 of 8 refusal runs re-read notes-2 twice before writing, 3 ran out of the 14-iteration cap",
  task: TASK,
  tools,
  policy: policyWith(rereads),
  ideal: {
    terminatedBy: "end_turn",
    status: "completed",
    toolSeq: NOTES.flatMap(() => ["file-read", "file-write"]),
    maxTurns: 13 + rereads,
  },
  run: { maxIterations, requiredTools: ["file-read", "file-write"], tier: "mid" },
});

/**
 * Live cap (h3-todo-heavy `maxIterations: 14`) with a model that burns three turns on the stall (the sim lets
 * one of the repeated re-reads execute, so 3 here costs about what the live 2 refused re-reads did).
 * Since 57d8f073b an all-refused duplicate round is refunded (bounded to 3 in a row), so it now completes at 14
 * (cause E fixed). Cap name = the live cap; the wide arm below uses 18.
 */
export const pendingWriteStubbornCap14: Shape = base("pending-write-stubborn-cap14", 3, 14);
/** The same stubborn model with a budget of 18 that fits (id keeps "cap16" for history): it completes, so the loss is the budget, not the hint. */
export const pendingWriteStubbornCap16: Shape = base("pending-write-stubborn-cap16", 3, 18);

/** A model that never takes the refusal: re-reads notes-2 30 times at the live cap. The refund bound (3 in a row) must still end it. */
export const pendingWriteEndless: Shape = base("pending-write-endless-reread", 30, 14);

export const pendingWrite: Shape = {
  id: "pending-write",
  sourceTraceId: "zoo-live addendum 5 (2026-11-18): cogito:8b h3-todo-heavy 0/10 cause A (6 of 10); fix 132ae5515",
  task: TASK,
  tools,
  policy: policyWith(1),
  ideal: {
    terminatedBy: "end_turn",
    status: "completed",
    toolSeq: NOTES.flatMap(() => ["file-read", "file-write"]),
    maxTurns: 14,
  },
  run: { maxIterations: 16, requiredTools: ["file-read", "file-write"], tier: "mid" },
};
