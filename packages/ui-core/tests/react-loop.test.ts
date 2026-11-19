import { describe, expect, test } from "bun:test";
import { compactArgs, reactLoopChip, reactLoopOf, type LoopCallInput } from "../src/index.js";

const call = (id: string, name: string, iteration: number, extra: Partial<LoopCallInput> = {}): LoopCallInput => ({ id, name, status: "done", iteration, ...extra });

describe("reactLoopOf", () => {
  test("a scripted run reads as Thought, Action, Observation rows and settles on the answer", () => {
    const loop = reactLoopOf({
      ended: true,
      steps: [
        { iteration: 1, narration: "I need the BTC price." },
        { iteration: 2, narration: "Now ETH." },
        { iteration: 3, narration: "Here is the report." },
      ],
      calls: [
        call("a", "crypto-price", 1, { args: { symbol: "BTC", limit: 5 }, result: "BTC 91,000\nUSD" }),
        call("b", "mcp__market__get_price", 2, { args: { symbol: "ETH" }, status: "failed", error: "[Tool error: rate limited]\n\n[Recovery guidance x]" }),
      ],
    });
    // The text-only last iteration is the answer, not a loop row.
    expect(loop.rows.map((r) => r.iteration)).toEqual([1, 2]);
    expect(loop.rows[0]).toMatchObject({ n: 1, thought: "I need the BTC price.", current: false });
    expect(loop.rows[0]!.actions[0]).toMatchObject({ shortName: "crypto-price", args: 'symbol="BTC", limit=5', status: "done", observation: "BTC 91,000 USD" });
    expect(loop.rows[1]!.actions[0]).toMatchObject({ shortName: "get_price", status: "failed", observation: "rate limited" });
    expect(loop.tools).toEqual(["crypto-price", "get_price"]);
    expect(loop.failedCalls).toBe(1);
    expect(reactLoopChip(loop, true)).toBe("2 iterations, 2 tools");
  });

  test("a live run highlights the current iteration and names its running tool", () => {
    const loop = reactLoopOf({
      ended: false,
      steps: [{ iteration: 1, narration: "Searching." }, { iteration: 2, thought: "Reading the page." }],
      calls: [call("a", "web-search", 1, { result: "3 hits" }), call("b", "http-get", 2, { status: "running" })],
    });
    expect(loop.rows.map((r) => r.current)).toEqual([false, true]);
    expect(loop.rows[1]!.actions[0]).toMatchObject({ status: "running" });
    expect(loop.rows[1]!.actions[0]!.observation).toBeUndefined();
    expect(reactLoopChip(loop, false)).toBe("Iteration 2 · http-get");
  });

  test("a live iteration that only thinks so far is shown; a call that never reported back fails once the turn ended", () => {
    expect(reactLoopOf({ ended: false, steps: [{ iteration: 1, narration: "Hmm." }], calls: [] }).rows).toHaveLength(1);
    const ended = reactLoopOf({ ended: true, steps: [], calls: [call("a", "shell-execute", 1, { status: "running" })] });
    expect(ended.rows[0]!.actions[0]).toMatchObject({ status: "failed", observation: "no result reported" });
  });

  test("the final-answer call is no action, a call with no iteration joins the last one, no rows chips to undefined", () => {
    const loop = reactLoopOf({ ended: true, steps: [{ iteration: 1, narration: "x" }], calls: [call("a", "final-answer", 1), { id: "b", name: "todo", status: "done" }] });
    expect(loop.rows).toHaveLength(1);
    expect(loop.rows[0]!.actions.map((a) => a.name)).toEqual(["todo"]);
    expect(reactLoopChip(reactLoopOf({ ended: true, steps: [], calls: [] }), true)).toBeUndefined();
  });

  test("a host can redact arguments, and long text is capped to one line", () => {
    const loop = reactLoopOf({ ended: true, steps: [{ iteration: 1, narration: "a\n".repeat(300) }], calls: [call("a", "t", 1, { args: { key: "secret" }, result: "r".repeat(500) })], describeArgs: () => "[redacted]" });
    expect(loop.rows[0]!.actions[0]!.args).toBe("[redacted]");
    expect(loop.rows[0]!.thought!.length).toBeLessThanOrEqual(200);
    expect(loop.rows[0]!.thought).not.toContain("\n");
    expect(loop.rows[0]!.actions[0]!.observation!.length).toBeLessThanOrEqual(140);
  });
});

describe("compactArgs", () => {
  test("objects read as key=value, nested values collapse, strings pass through, empty is empty", () => {
    expect(compactArgs({ q: "btc", opts: { a: 1 }, list: [1, 2] })).toBe('q="btc", opts={…}, list=[2]');
    expect(compactArgs("ls -la")).toBe("ls -la");
    expect(compactArgs(undefined)).toBe("");
  });
});
