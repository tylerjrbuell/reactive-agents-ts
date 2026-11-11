import { describe, expect, test } from "bun:test";
import {
  buildTurnSteps,
  buildTurnTranscript,
  finishTurnTrace,
  foldTurnTrace,
  initialTurnTrace,
  persistedTurnTranscriptOf,
  turnTranscriptOf,
  type TranscriptSegment,
  type UiStreamEvent,
} from "../src/index.js";

const run = (events: UiStreamEvent[]) => events.reduce(foldTurnTrace, initialTurnTrace());
const meta = { duration: 1, cost: 0, tokensUsed: 1, stepsCount: 1 };
const progress = (iteration: number): UiStreamEvent => ({ _tag: "IterationProgress", iteration, maxIterations: 10, status: "r" });
const say = (text: string): UiStreamEvent => ({ _tag: "TextDelta", text });
const thinking = (iteration: number, content: string): UiStreamEvent => ({ _tag: "ThinkingEmitted", iteration, content });
const started = (id: string, toolName: string): UiStreamEvent => ({ _tag: "ToolCallStarted", toolName, callId: id });
const completed = (id: string, toolName: string, ok: boolean, error?: string): UiStreamEvent => ({
  _tag: "ToolCallCompleted",
  toolName,
  callId: id,
  durationMs: 10,
  success: ok,
  ...(error ? { error } : {}),
});
const call = (id: string, toolName: string, ok: boolean, error?: string): UiStreamEvent[] => [
  started(id, toolName),
  completed(id, toolName, ok, error),
];
const done = (output: string): UiStreamEvent => ({ _tag: "StreamCompleted", output, metadata: meta });

/** `kind:text` shorthand for asserting reading order. */
const shape = (segments: readonly TranscriptSegment[]): string[] =>
  segments.map((s) => (s.kind === "tools" ? `tools:${s.label}` : `${s.kind}:${s.text}`));

const ANSWER = "Your site had 1,204 visits last week, up 12%.";

/** Two iterations of narration + tools, a silent tool iteration, then the answer. */
const multiIteration: UiStreamEvent[] = [
  progress(1),
  say("Let me find your website first."),
  ...call("c1", "umami/list_websites", true),
  progress(2),
  say("Found it. Now the stats and metrics."),
  ...call("c2", "umami/get_website_stats", true),
  ...call("c3", "umami/get_website_metrics", false, "[Tool error: Missing required parameter \"type\"]"),
  progress(3),
  ...call("c4", "umami/get_website_metrics", true),
  progress(4),
  say(ANSWER),
  done(ANSWER),
];

describe("turnTranscriptOf", () => {
  test("reads as prose → tools → prose → tools → answer, consecutive tool steps collapsed", () => {
    const t = turnTranscriptOf(run(multiIteration));
    expect(shape(t)).toEqual([
      "prose:Let me find your website first.",
      "tools:Ran 1 tool",
      "prose:Found it. Now the stats and metrics.",
      "tools:Ran 3 tools · 1 failed, 1 fixed",
      `answer:${ANSWER}`,
    ]);
    const group = t[3]!;
    if (group.kind !== "tools") throw new Error("expected tools");
    expect(group.tools).toEqual(["get_website_stats", "get_website_metrics"]);
    expect(group.calls.map((c) => c.id)).toEqual(["c2", "c3", "c4"]);
    expect(group.failed).toBe(1);
    expect(group.fixed).toBe(1);
    expect(group.durationMs).toBe(30);
    expect(t[4]).toMatchObject({ kind: "answer", final: true });
  });

  test("provider thinking never becomes prose", () => {
    const t = turnTranscriptOf(
      run([progress(1), thinking(1, "The user wants traffic. I should list sites."), ...call("c1", "list_websites", true), progress(2), say(ANSWER), done(ANSWER)]),
    );
    expect(shape(t)).toEqual(["tools:Ran 1 tool", `answer:${ANSWER}`]);
    const group = t[0]!;
    if (group.kind !== "tools") throw new Error("expected tools");
    expect(group.steps[0]!.thinking).toContain("list sites");
  });

  test("narration restating the answer (or earlier prose) is dropped", () => {
    const long = "Here is the full traffic report for your documentation website, last 7 days.";
    const t = turnTranscriptOf(
      run([
        progress(1),
        say("Checking."),
        ...call("c1", "a", true),
        progress(2),
        say("Checking."),
        ...call("c2", "b", true),
        progress(3),
        say(long),
        ...call("c3", "c", true),
        progress(4),
        say(`${long}\n\nVisits: 1,204.`),
        done(`${long}\n\nVisits: 1,204.`),
      ]),
    );
    expect(shape(t)).toEqual(["prose:Checking.", "tools:Ran 3 tools", `answer:${long}\n\nVisits: 1,204.`]);
  });

  test("streaming: running group label, then the live preview as a non-final answer", () => {
    const mid = run([progress(1), say("Let me look that up."), started("c1", "umami/get_website_stats")]);
    expect(shape(turnTranscriptOf(mid))).toEqual(["prose:Let me look that up.", "tools:Running get_website_stats"]);
    expect((turnTranscriptOf(mid)[1] as { running: boolean }).running).toBe(true);

    const streaming = run([progress(1), say("Let me look that up."), ...call("c1", "get_website_stats", true), progress(2), say("Your site had")]);
    const t = turnTranscriptOf(streaming);
    expect(shape(t)).toEqual(["prose:Let me look that up.", "tools:Ran 1 tool", "answer:Your site had"]);
    expect(t[2]).toMatchObject({ kind: "answer", final: false });
  });

  test("a turn with no tools is just the answer", () => {
    expect(shape(turnTranscriptOf(run([progress(1), say("Hi!"), done("Hi!")])))).toEqual(["answer:Hi!"]);
  });
});

describe("persistedTurnTranscriptOf", () => {
  test("a stored multi-iteration turn reads the same as it did live", () => {
    const live = run(multiIteration);
    const stored = finishTurnTrace(live)!;
    expect(shape(persistedTurnTranscriptOf(stored, ANSWER))).toEqual(shape(turnTranscriptOf(live)));
  });

  test("an old trace without narration degrades to one tool group + the answer", () => {
    const stored = {
      reasoningSteps: [],
      toolCalls: [
        { id: "a", name: "list_websites", status: "done" as const, iteration: 1 },
        { id: "b", name: "get_website_stats", status: "done" as const, iteration: 2 },
      ],
    };
    expect(shape(persistedTurnTranscriptOf(stored, ANSWER))).toEqual(["tools:Ran 2 tools", `answer:${ANSWER}`]);
  });
});

describe("buildTurnTranscript", () => {
  test("works over steps built from your own data; answer wins over pending", () => {
    const steps = buildTurnSteps({
      iterations: [{ iteration: 1, narration: "Searching." }],
      calls: [{ id: "x", name: "web_search", status: "done", iteration: 1 }],
    });
    const t = buildTurnTranscript(steps, { answer: "Done.", pending: "Do" });
    expect(shape(t)).toEqual(["prose:Searching.", "tools:Ran 1 tool", "answer:Done."]);
  });

  test("prose the answer or the live preview already holds is dropped, even when the steps kept it", () => {
    const lead = "Here is the full traffic report for your documentation website.";
    const steps = buildTurnSteps({
      iterations: [
        { iteration: 1, narration: "Searching." },
        { iteration: 2, narration: lead },
      ],
      calls: [
        { id: "x", name: "web_search", status: "done", iteration: 1 },
        { id: "y", name: "fetch", status: "done", iteration: 2 },
      ],
    });
    expect(shape(buildTurnTranscript(steps, { answer: `${lead}\n\nVisits: 1,204.` }))).toEqual([
      "prose:Searching.",
      "tools:Ran 2 tools",
      `answer:${lead}\n\nVisits: 1,204.`,
    ]);
    expect(shape(buildTurnTranscript(steps, { pending: lead }))).toEqual(["prose:Searching.", "tools:Ran 2 tools", `answer:${lead}`]);
  });
});
