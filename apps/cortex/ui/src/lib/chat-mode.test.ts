import { describe, expect, test } from "bun:test";
import { executedPlanTurnId, isModeShortcut, modeHint, modeLabel, nextMode, planCardTurnId } from "./chat-mode.js";
import type { ChatTurn } from "./stores/chat-store.js";

const turn = (id: number, role: "user" | "assistant", over: Partial<ChatTurn> = {}): ChatTurn =>
  ({ id, role, content: role === "assistant" ? "a plan" : "q", tokensUsed: 0, ts: id, ...over }) as ChatTurn;

describe("chat mode helpers", () => {
  test("labels and hints", () => {
    expect(modeLabel("plan")).toBe("Plan");
    expect(modeLabel("execute")).toBe("Execute");
    expect(modeHint("plan")).toBe("Reasoning only: no tools until you Execute");
    expect(modeHint("execute")).toContain("tools");
  });

  test("nextMode toggles", () => {
    expect(nextMode("plan")).toBe("execute");
    expect(nextMode("execute")).toBe("plan");
  });

  test("planCardTurnId: latest finished assistant turn, only in plan mode", () => {
    const turns = [turn(1, "user"), turn(2, "assistant"), turn(3, "user"), turn(4, "assistant")];
    expect(planCardTurnId(turns, "plan")).toBe(4);
    expect(planCardTurnId(turns, "execute")).toBeUndefined();
  });

  test("planCardTurnId skips a streaming, empty or failed latest turn", () => {
    expect(planCardTurnId([turn(1, "user"), turn(2, "assistant", { streaming: true })], "plan")).toBeUndefined();
    expect(planCardTurnId([turn(1, "user"), turn(2, "assistant", { content: "  " })], "plan")).toBeUndefined();
    expect(planCardTurnId([turn(1, "user")], "plan")).toBeUndefined();
    // the thread's last turn is the user's: the previous plan is already answered
    expect(planCardTurnId([turn(1, "user"), turn(2, "assistant"), turn(3, "user")], "plan")).toBeUndefined();
  });

  test("a plan turn paused on a question is never wrapped in the plan card, so its reply controls stay visible", () => {
    const asking = turn(2, "assistant", { streaming: true, liveInteraction: { runId: "r", interactionId: "i", kind: "form", prompt: "Which site?", schema: {} } });
    expect(planCardTurnId([turn(1, "user"), asking], "plan")).toBeUndefined();
  });

  test("executedPlanTurnId: the assistant turn before the latest 'Execute the plan.' turn", () => {
    const run = [turn(1, "user"), turn(2, "assistant"), turn(3, "user", { content: "Execute the plan." }), turn(4, "assistant")];
    expect(executedPlanTurnId(run)).toBe(2);
    // a later execute wins; none = undefined; a leading execute turn has no plan before it
    expect(executedPlanTurnId([...run, turn(5, "user"), turn(6, "assistant"), turn(7, "user", { content: " Execute the plan. " }), turn(8, "assistant")])).toBe(6);
    expect(executedPlanTurnId([turn(1, "user"), turn(2, "assistant")])).toBeUndefined();
    expect(executedPlanTurnId([turn(1, "user", { content: "Execute the plan." })])).toBeUndefined();
  });

  test("Shift+Tab is the mode shortcut; plain Tab, IME and slash drafts are not", () => {
    const k = { key: "Tab", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, isComposing: false };
    expect(isModeShortcut(k, "hello")).toBe(true);
    expect(isModeShortcut({ ...k, shiftKey: false }, "hello")).toBe(false);
    expect(isModeShortcut({ ...k, isComposing: true }, "hello")).toBe(false);
    expect(isModeShortcut(k, "/mod")).toBe(false);
    expect(isModeShortcut({ ...k, key: "Enter" }, "hello")).toBe(false);
  });
});
