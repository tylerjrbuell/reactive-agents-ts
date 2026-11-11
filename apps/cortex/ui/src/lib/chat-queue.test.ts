import { describe, expect, it } from "bun:test";
import { composerAction, lastRunFailed, queueMessage, queuePreview, queuedAfterRun } from "./chat-queue.js";

describe("queueMessage (single pending draft slot)", () => {
  it("holds the first queued message", () => {
    expect(queueMessage(null, "  next question  ")).toBe("next question");
  });
  it("ignores blank input and keeps what is queued", () => {
    expect(queueMessage(null, "   ")).toBeNull();
    expect(queueMessage("kept", "\n\t")).toBe("kept");
  });
  it("appends a second message instead of silently dropping the first", () => {
    expect(queueMessage("first", "second")).toBe("first\nsecond");
  });
});

describe("queuePreview", () => {
  it("shows one line, whitespace collapsed", () => {
    expect(queuePreview("line one\n\n  line   two")).toBe("line one line two");
  });
  it("truncates long text with an ellipsis", () => {
    const out = queuePreview("x".repeat(200), 20);
    expect(out.length).toBe(20);
    expect(out.endsWith("…")).toBe(true);
  });
  it("leaves short text alone", () => {
    expect(queuePreview("short", 20)).toBe("short");
  });
});

describe("composerAction (send button)", () => {
  it("is send when idle", () => {
    expect(composerAction({ sending: false, hasText: false })).toBe("send");
    expect(composerAction({ sending: false, hasText: true })).toBe("send");
  });
  it("is stop while sending with an empty input", () => {
    expect(composerAction({ sending: true, hasText: false })).toBe("stop");
  });
  it("is queue while sending with text in the input", () => {
    expect(composerAction({ sending: true, hasText: true })).toBe("queue");
  });
  it("is send for a config command during a run (it applies to the next turn, never queues)", () => {
    expect(composerAction({ sending: true, hasText: true, configCommand: true })).toBe("send");
  });
});

describe("queuedAfterRun (auto-submit when the run ends)", () => {
  const base = { wasSending: true, sending: false, queued: "next", aborted: false } as const;

  it("submits the queued message when a run completes normally", () => {
    expect(queuedAfterRun(base)).toBe("send");
  });
  it("does nothing while the run is still going", () => {
    expect(queuedAfterRun({ ...base, sending: true })).toBe("none");
  });
  it("does nothing when there is no queued message", () => {
    expect(queuedAfterRun({ ...base, queued: null })).toBe("none");
  });
  it("does nothing when the run did not transition from sending", () => {
    expect(queuedAfterRun({ ...base, wasSending: false })).toBe("none");
  });
  it("keeps the queue (no auto-submit) after an error or a user stop", () => {
    expect(queuedAfterRun({ ...base, aborted: true })).toBe("keep");
  });
});

describe("lastRunFailed", () => {
  // Live 2026-11-10: a turn failed (Anthropic 400) with a normal StreamCompleted, the queued
  // message auto-sent into the same failing provider, and a second "<agent> failed" toast followed.
  it("is true when the latest assistant turn reported a failed run", () => {
    const turns = [
      { role: "user" },
      { role: "assistant", runFailed: { terminatedBy: "llm_error" } },
    ];
    expect(lastRunFailed(turns)).toBe(true);
    expect(queuedAfterRun({ wasSending: true, sending: false, queued: "next", aborted: lastRunFailed(turns) })).toBe("keep");
  });
  it("only looks at the latest assistant turn", () => {
    expect(lastRunFailed([{ role: "assistant", runFailed: {} }, { role: "user" }, { role: "assistant" }])).toBe(false);
    expect(lastRunFailed([{ role: "assistant" }, { role: "user" }])).toBe(false);
    expect(lastRunFailed([])).toBe(false);
  });
});
