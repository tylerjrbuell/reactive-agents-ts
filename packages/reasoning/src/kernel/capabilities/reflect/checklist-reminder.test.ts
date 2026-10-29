// Run: bun test packages/reasoning/src/kernel/capabilities/reflect/checklist-reminder.test.ts --timeout 15000
//
// Direct-import seam pin for reflect/checklist-reminder.ts — the opt-in,
// default-OFF M3-midrun todo reminder + M1 system line (plan
// 2026-10-28-plan-and-goal-primitives, ruling V5).
import { describe, expect, it } from "bun:test";
import type { AdvisoryItem } from "@reactive-agents/core";
import {
  CHECKLIST_REMINDER_CAP,
  CHECKLIST_REMINDER_SIGNAL_KIND,
  CHECKLIST_SYSTEM_LINE,
  appendChecklistReminder,
  buildChecklistReminder,
  checklistSystemLine,
  summarizeRecentRounds,
  type ChecklistReminderInput,
} from "./checklist-reminder.js";
import { appendEntries } from "../../ledger/run-ledger.js";

const open: AdvisoryItem[] = [
  { id: "1", seq: 1, title: "find data", status: "pending" },
  { id: "2", seq: 2, title: "write report", status: "in_progress" },
  { id: "3", seq: 3, title: "already done", status: "completed" },
];
const stale = [
  { toolNames: ["web-search"], todoStatusChanges: 0 },
  { toolNames: ["http-get"], todoStatusChanges: 0 },
];
const base: ChecklistReminderInput = {
  enabled: true,
  todoVisible: true,
  items: open,
  recentRounds: stale,
  remindersFired: 0,
};

describe("buildChecklistReminder (M3-midrun producer)", () => {
  it("fires with the open rows when every trigger clause holds", () => {
    expect(buildChecklistReminder(base)).toBe(
      "Todo: 2 open ([1] find data, [2] write report). Mark finished items done (todo action done, id) before continuing.",
    );
  });
  it("is inert when the option is off", () => {
    expect(buildChecklistReminder({ ...base, enabled: false })).toBeUndefined();
  });
  it("is inert when todo is not visible", () => {
    expect(buildChecklistReminder({ ...base, todoVisible: false })).toBeUndefined();
  });
  it("is inert when no advisory row is pending or in_progress", () => {
    expect(buildChecklistReminder({ ...base, items: [open[2]!] })).toBeUndefined();
    expect(buildChecklistReminder({ ...base, items: [] })).toBeUndefined();
  });
  it("needs two completed rounds", () => {
    expect(buildChecklistReminder({ ...base, recentRounds: [stale[1]!] })).toBeUndefined();
    expect(buildChecklistReminder({ ...base, recentRounds: [] })).toBeUndefined();
  });
  it("is inert when either round changed a todo status", () => {
    expect(
      buildChecklistReminder({ ...base, recentRounds: [{ toolNames: ["web-search"], todoStatusChanges: 1 }, stale[1]!] }),
    ).toBeUndefined();
    expect(
      buildChecklistReminder({ ...base, recentRounds: [stale[0]!, { toolNames: ["http-get"], todoStatusChanges: 2 }] }),
    ).toBeUndefined();
  });
  it("is inert when either round ran no non-todo tool", () => {
    expect(buildChecklistReminder({ ...base, recentRounds: [{ toolNames: [], todoStatusChanges: 0 }, stale[1]!] })).toBeUndefined();
    expect(buildChecklistReminder({ ...base, recentRounds: [stale[0]!, { toolNames: ["todo"], todoStatusChanges: 0 }] })).toBeUndefined();
  });
  it("caps at 2 reminders per run", () => {
    expect(CHECKLIST_REMINDER_CAP).toBe(2);
    expect(buildChecklistReminder({ ...base, remindersFired: 1 })).toBeDefined();
    expect(buildChecklistReminder({ ...base, remindersFired: 2 })).toBeUndefined();
  });
  it("never fires on the iteration that produced the final answer", () => {
    expect(buildChecklistReminder({ ...base, producedFinalAnswer: true })).toBeUndefined();
  });
  it("lists at most 5 rows and counts the rest", () => {
    const many: AdvisoryItem[] = Array.from({ length: 7 }, (_, i) => ({
      id: String(i + 1), seq: i + 1, title: `t${i + 1}`, status: "pending" as const,
    }));
    const text = buildChecklistReminder({ ...base, items: many })!;
    expect(text).toContain("Todo: 7 open ([1] t1, [2] t2, [3] t3, [4] t4, [5] t5, +2 more).");
  });
});

describe("checklistSystemLine (M1)", () => {
  it("renders one stable line only when todo is visible AND the option is on", () => {
    expect(checklistSystemLine(true, true)).toBe(CHECKLIST_SYSTEM_LINE);
    expect(checklistSystemLine(true, false)).toBeUndefined();
    expect(checklistSystemLine(false, true)).toBeUndefined();
    expect(CHECKLIST_SYSTEM_LINE.includes("\n")).toBe(false);
  });
});

describe("appendChecklistReminder (Guidance: rendering)", () => {
  it("is the identity when there is no reminder", () => {
    expect(appendChecklistReminder("Guidance:\n- a", undefined)).toBe("Guidance:\n- a");
    expect(appendChecklistReminder(null, undefined)).toBeNull();
  });
  it("opens a Guidance: block when none exists", () => {
    expect(appendChecklistReminder(null, "R")).toBe("Guidance:\n- R");
  });
  it("appends a bullet to an existing Guidance: block", () => {
    expect(appendChecklistReminder("Guidance:\n- a", "R")).toBe("Guidance:\n- a\n- R");
  });
});

describe("summarizeRecentRounds (ledger adapter)", () => {
  const inv = (iteration: number, toolName: string) => ({ kind: "tool-invocation" as const, iteration, toolName });
  const st = (iteration: number, status: "pending" | "in_progress" | "completed") => ({
    kind: "checklist-item" as const, iteration, change: { op: "status" as const, id: "1", status },
  });
  it("returns the last two completed rounds (labels current-1 and current), oldest first", () => {
    const ledger = appendEntries(undefined, [inv(1, "x"), inv(2, "web-search"), inv(3, "http-get"), inv(3, "todo"), st(3, "completed"), inv(4, "y")]);
    expect(summarizeRecentRounds(ledger, 3)).toEqual([
      { toolNames: ["web-search"], todoStatusChanges: 0 },
      { toolNames: ["http-get", "todo"], todoStatusChanges: 1 },
    ]);
  });
  it("yields empty rounds for iterations with no tool call", () => {
    expect(summarizeRecentRounds(appendEntries(undefined, [inv(2, "a")]), 3)).toEqual([
      { toolNames: ["a"], todoStatusChanges: 0 },
      { toolNames: [], todoStatusChanges: 0 },
    ]);
  });
  it("ignores merged sub-agent facts", () => {
    const ledger = appendEntries(undefined, [inv(2, "a"), inv(3, "b"), { ...st(3, "completed"), pass: "sub-agent:x" as never }]);
    expect(summarizeRecentRounds(ledger, 3)[1]!.todoStatusChanges).toBe(0);
  });
});

describe("signal kind", () => {
  it("is stable (the cap counts ledger signals of this kind)", () => {
    expect(CHECKLIST_REMINDER_SIGNAL_KIND).toBe("checklist-reminder");
  });
});
