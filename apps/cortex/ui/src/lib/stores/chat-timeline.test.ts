import { describe, expect, test } from "bun:test";
import { buildTimeline, previewArgs, turnEnding, turnSteps, turnSummary, turnTranscript } from "./chat-timeline.js";

describe("turnSteps (ui-core step view over a chat turn)", () => {
  test("titles steps by action, never by thought; legacy thought-only steps read as narration", () => {
    const steps = turnSteps({
      reasoningSteps: [
        { iteration: 1, maxIterations: 5, thought: "I need prices for four coins. Search each one." },
        { iteration: 2, maxIterations: 5, thought: "x", thinking: "All four found.", narration: "Build the table." },
      ],
      toolCalls: [
        { id: "a", name: "web-search", status: "done", iteration: 1, durationMs: 1400 },
        { id: "b", name: "web-search", status: "failed", iteration: 1, durationMs: 1500, error: "x" },
        { id: "c", name: "http-get", status: "done", iteration: 1, durationMs: 100 },
      ],
      content: "| table |",
    });
    expect(steps.map((s) => [s.n, s.key, s.label, s.status, s.durationMs])).toEqual([
      [1, "i1", "web-search ×2 · 1 failed, http-get", "failed", 3000],
      [2, "i2", "No tool call", "done", undefined],
    ]);
    expect(steps[0]!.narration).toBe("I need prices for four coins. Search each one.");
    expect(steps[1]).toMatchObject({ thinking: "All four found.", narration: "Build the table." });
  });

  test("a running call marks the step running; the summary has no outcome while streaming", () => {
    const turn = {
      toolCalls: [
        { id: "a", name: "web-search", status: "done" as const, iteration: 1 },
        { id: "b", name: "web-search", status: "running" as const, iteration: 1 },
      ],
      content: "",
      streaming: true,
    };
    expect(turnSteps(turn)[0]!.status).toBe("running");
    expect(turnSummary(turn).line).toBe("1 step · 2 calls (1 tool) · running");
  });

  test("summary line shows the outcome and the context window in use", () => {
    const sum = turnSummary({
      content: "x",
      runFailed: { terminatedBy: "llm_error" },
      context: { tokensUsed: 7496, windowTokens: 32768 },
    });
    expect(sum.line).toBe("0 steps · failed · context 7.5k / 32.8k");
  });

  test("turnEnding", () => {
    expect(turnEnding({ streaming: true })).toBeUndefined();
    expect(turnEnding({ cancelled: true })).toBe("cancelled");
    expect(turnEnding({ incomplete: true })).toBe("errored");
    expect(turnEnding({})).toBe("succeeded");
  });
});

describe("buildTimeline", () => {
  test("orders thought before the tools of the same iteration, iterations ascending", () => {
    const items = buildTimeline({
      reasoningSteps: [
        { iteration: 2, maxIterations: 5, thought: "now summarise" },
        { iteration: 1, maxIterations: 5, thought: "search first" },
      ],
      toolCalls: [
        { id: "b", name: "http-get", status: "done", iteration: 2 },
        { id: "a", name: "web-search", status: "done", iteration: 1 },
      ],
    });
    expect(items.map((i) => (i.kind === "thought" ? `t${i.iteration}` : i.call.id))).toEqual(["t1", "a", "t2", "b"]);
  });

  test("tool call without a thought still appears; blank thoughts are dropped; unknown iteration trails", () => {
    const items = buildTimeline({
      reasoningSteps: [{ iteration: 1, maxIterations: 3, thought: "   " }],
      toolCalls: [
        { id: "late", name: "x", status: "running" },
        { id: "a", name: "web-search", status: "failed", iteration: 1, error: "boom" },
      ],
    });
    expect(items.map((i) => (i.kind === "tool" ? i.call.id : "thought"))).toEqual(["a", "late"]);
  });

  test("previewArgs stringifies and truncates", () => {
    expect(previewArgs({ q: "hi" })).toBe('{"q":"hi"}');
    expect(previewArgs("x".repeat(100), 10)).toBe("xxxxxxxxxx…");
    expect(previewArgs(undefined)).toBe("");
  });

  test("previewArgs and prettyArgs redact credential-shaped values in tool arguments", async () => {
    const { prettyArgs } = await import("./chat-timeline.js");
    const args = { url: "https://api.x.dev/v1?api_key=abc123secret", headers: { Authorization: "Bearer abcdefghijkl" } };
    const preview = previewArgs(args, 500);
    expect(preview).not.toContain("abc123secret");
    expect(preview).not.toContain("abcdefghijkl");
    expect(preview).toContain("?api_key=[redacted]");
    const pretty = prettyArgs(args);
    expect(pretty).toContain('"Authorization": "Bearer [redacted]"');
    expect(prettyArgs("curl -H 'x: sk-live1234567890'")).toBe("curl -H 'x: [redacted]'");
  });
});

describe("hydrateTurn", () => {
  test("restores persisted thinking + tool calls so a reloaded turn renders a timeline", async () => {
    const { hydrateTurn } = await import("./chat-store.js");
    const turn = hydrateTurn({
      id: 1,
      role: "assistant",
      content: "done",
      tokensUsed: 5,
      ts: 0,
      trace: {
        reasoningSteps: [{ iteration: 1, thought: "search first" }],
        toolCalls: [{ id: "c1", name: "web-search", status: "done", iteration: 1, args: { q: "x" }, result: "r" }],
      },
    });
    const items = buildTimeline(turn);
    expect(items.map((i) => i.kind)).toEqual(["thought", "tool"]);
    expect((items[1] as { call: { args: unknown } }).call.args).toEqual({ q: "x" });
    expect("trace" in turn).toBe(false);
  });
});

describe("turnTranscript (the assistant turn as the agent talking)", () => {
  const shape = (segments: ReturnType<typeof turnTranscript>): string[] =>
    segments.map((s) =>
      s.kind === "tools" ? `tools:${s.label}` : s.kind === "ending" ? `ending:${s.outcome.ending}` : `${s.kind}:${s.text}`,
    );

  test("a stored multi-iteration turn reads prose → tools → prose → tools → answer after reload", async () => {
    const { hydrateTurn } = await import("./chat-store.js");
    const answer = "Your docs site had 1,204 visits last week.";
    const turn = hydrateTurn({
      id: 7,
      role: "assistant",
      content: answer,
      tokensUsed: 900,
      ts: 0,
      trace: {
        reasoningSteps: [
          { iteration: 1, thought: "Let me find the site.", narration: "Let me find the site." },
          { iteration: 2, thought: "Users want traffic.\n\nFound it; pulling stats.", thinking: "Users want traffic.", narration: "Found it; pulling stats." },
          { iteration: 4, thought: answer, narration: answer },
        ],
        toolCalls: [
          { id: "c1", name: "umami/list_websites", status: "done", iteration: 1 },
          { id: "c2", name: "umami/get_website_stats", status: "done", iteration: 2 },
          { id: "c3", name: "umami/get_website_metrics", status: "failed", iteration: 2, error: "[Tool error: Missing type]" },
          { id: "c4", name: "umami/get_website_metrics", status: "done", iteration: 3 },
        ],
      },
    });
    const t = turnTranscript(turn);
    expect(shape(t)).toEqual([
      "prose:Let me find the site.",
      "tools:Ran 1 tool",
      "prose:Found it; pulling stats.",
      "tools:Ran 3 tools · 1 failed, 1 fixed",
      `answer:${answer}`,
    ]);
    // Thinking is kept for drill-down on the group's steps, never as prose.
    const group = t[3]!;
    if (group.kind !== "tools") throw new Error("expected a tool group");
    expect(group.steps[0]!.thinking).toBe("Users want traffic.");
  });

  test("a turn persisted with tool calls but no narration is one tool group + the answer", () => {
    const t = turnTranscript({
      content: "Done.",
      toolCalls: [
        { id: "a", name: "web-search", status: "done", iteration: 1 },
        { id: "b", name: "http-get", status: "done", iteration: 2 },
      ],
    });
    expect(shape(t)).toEqual(["tools:Ran 2 tools", "answer:Done."]);
  });

  test("while streaming: the running group says what runs, the in-flight text is a non-final answer", () => {
    const running = turnTranscript({
      streaming: true,
      content: "",
      reasoningSteps: [{ iteration: 1, maxIterations: 5, narration: "Searching." }],
      toolCalls: [{ id: "a", name: "web-search", status: "running", iteration: 1 }],
    });
    expect(shape(running)).toEqual(["prose:Searching.", "tools:Running web-search"]);
    const previewing = turnTranscript({
      streaming: true,
      content: "",
      liveText: "The price is",
      toolCalls: [{ id: "a", name: "web-search", status: "done", iteration: 1 }],
    });
    expect(previewing.at(-1)).toMatchObject({ kind: "answer", text: "The price is", final: false });
  });
});

describe("capFrameText", () => {
  test("caps runaway text with an explicit marker; leaves normal text alone", async () => {
    const { capFrameText } = await import("./trace-store.js");
    expect(capFrameText("abc", 10)).toBe("abc");
    expect(capFrameText("x".repeat(15), 10)).toBe("xxxxxxxxxx\n…[truncated 5 chars]");
  });
});
