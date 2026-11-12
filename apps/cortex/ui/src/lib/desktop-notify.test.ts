import { describe, it, expect } from "bun:test";
import {
  shouldNotify,
  createDesktopNotifier,
  showDesktopNotice,
  TEST_NOTICE,
  type DesktopNotice,
  type NotifyEnv,
  type NotifyKind,
} from "./desktop-notify.js";
import { approvalNotice, questionNotice, runEndNotice } from "./stores/desktop-notifier.js";
import { runEndToast } from "./run-toast.js";

const BACKGROUND: NotifyEnv = { permission: "granted", hidden: true, focused: false };
const FOCUSED: NotifyEnv = { permission: "granted", hidden: false, focused: true };

describe("shouldNotify", () => {
  const kinds: readonly NotifyKind[] = ["run-finished", "run-failed", "approval-needed", "question-asked"];

  it("level none notifies nothing", () => {
    for (const k of kinds) expect(shouldNotify(k, "none", BACKGROUND)).toEqual({ notify: false, reason: "level" });
  });

  it("level failures notifies only failed runs", () => {
    expect(shouldNotify("run-failed", "failures", BACKGROUND).notify).toBe(true);
    expect(shouldNotify("run-finished", "failures", BACKGROUND).notify).toBe(false);
  });

  it("level completions notifies run ends, approvals and questions", () => {
    for (const k of kinds) expect(shouldNotify(k, "completions", BACKGROUND).notify).toBe(true);
  });

  it("approval-needed and question-asked per level", () => {
    for (const k of ["approval-needed", "question-asked"] as const) {
      expect(shouldNotify(k, "none", BACKGROUND).notify).toBe(false);
      expect(shouldNotify(k, "failures", BACKGROUND).notify).toBe(false);
      expect(shouldNotify(k, "completions", BACKGROUND).notify).toBe(true);
      expect(shouldNotify(k, "all", BACKGROUND).notify).toBe(true);
    }
  });

  it("level all notifies every kind", () => {
    for (const k of kinds) expect(shouldNotify(k, "all", BACKGROUND).notify).toBe(true);
  });

  it("is suppressed (visible) while the tab is shown and focused", () => {
    expect(shouldNotify("run-finished", "all", FOCUSED)).toEqual({ notify: false, reason: "visible" });
  });

  it("notifies when the tab is visible but another window has focus", () => {
    expect(shouldNotify("run-finished", "all", { permission: "granted", hidden: false, focused: false }).notify).toBe(true);
  });

  it("needs browser permission, not the notificationsEnabled flag", () => {
    expect(shouldNotify("run-finished", "all", { ...BACKGROUND, permission: "default" })).toEqual({ notify: false, reason: "permission" });
    expect(shouldNotify("run-finished", "all", { ...BACKGROUND, permission: "denied" }).notify).toBe(false);
    expect(shouldNotify("run-finished", "all", { ...BACKGROUND, permission: "unsupported" }).notify).toBe(false);
  });
});

function harness(initial: { level: "all" | "completions" | "failures" | "none"; env: NotifyEnv }) {
  const state = { ...initial };
  const shown: DesktopNotice[] = [];
  const notifier = createDesktopNotifier({
    getLevel: () => state.level,
    getEnv: () => state.env,
    show: (n) => shown.push(n),
  });
  return { state, shown, notifier };
}

describe("createDesktopNotifier (one Notification call per event)", () => {
  it("run finished: exactly one notice, however many end events arrive", () => {
    const h = harness({ level: "completions", env: BACKGROUND });
    const end = runEndToast({ type: "AgentCompleted", runId: "r1", name: "scout", payload: { success: true } });
    h.notifier.offer(runEndNotice(end!));
    const again = runEndToast({ type: "AgentCompleted", runId: "r1", name: "scout", payload: {} });
    expect(h.notifier.offer(runEndNotice(again!))).toEqual({ notify: false, reason: "duplicate" });
    expect(h.shown.map((n) => [n.kind, n.title, n.href])).toEqual([["run-finished", "scout completed", "/run/r1"]]);
  });

  it("run failed: carries the error and the failed kind", () => {
    const h = harness({ level: "failures", env: BACKGROUND });
    const end = runEndToast({ type: "TaskFailed", runId: "r2", name: "scout", payload: { error: "provider 500" } });
    h.notifier.offer(runEndNotice(end!));
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]).toMatchObject({ kind: "run-failed", title: "scout failed" });
    expect(h.shown[0]?.body).toContain("provider 500");
  });

  it("approval needed: one notice per gate, linking the chat or run", () => {
    const h = harness({ level: "all", env: BACKGROUND });
    const gate = { runId: "r3", agentId: "a", gateId: "g1", toolName: "shell-execute", args: { cmd: "ls" } };
    h.notifier.offer(approvalNotice(gate));
    h.notifier.offer(approvalNotice(gate));
    h.notifier.offer(approvalNotice({ ...gate, gateId: "g2", chatSessionId: "s9" }));
    expect(h.shown.map((n) => [n.kind, n.href])).toEqual([
      ["approval-needed", "/run/r3"],
      ["approval-needed", "/chat?session=s9"],
    ]);
  });

  it("question asked: one notice with the prompt", () => {
    const h = harness({ level: "all", env: BACKGROUND });
    const q = { runId: "r4", interactionId: "i1", kind: "choice" as const, prompt: "Which branch?", schema: {} };
    h.notifier.offer(questionNotice(q));
    h.notifier.offer(questionNotice(q));
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]).toMatchObject({ kind: "question-asked", body: "Which branch?", href: "/run/r4" });
  });

  it("reads the level at fire time, not at creation", () => {
    const h = harness({ level: "none", env: BACKGROUND });
    const end = runEndToast({ type: "AgentCompleted", runId: "r5", name: "n", payload: {} })!;
    expect(h.notifier.offer(runEndNotice(end)).notify).toBe(false);
    h.state.level = "completions";
    expect(h.notifier.offer(runEndNotice(end)).notify).toBe(true);
    expect(h.shown).toHaveLength(1);
  });

  it("a notice suppressed while focused still fires once the tab is hidden", () => {
    const h = harness({ level: "all", env: FOCUSED });
    const end = runEndToast({ type: "AgentCompleted", runId: "r6", name: "n", payload: {} })!;
    expect(h.notifier.offer(runEndNotice(end))).toEqual({ notify: false, reason: "visible" });
    h.state.env = BACKGROUND;
    expect(h.notifier.offer(runEndNotice(end)).notify).toBe(true);
    expect(h.shown).toHaveLength(1);
  });
});

describe("showDesktopNotice (the single Notification call, shared with Settings Test)", () => {
  it("constructs exactly one Notification with the key as tag", () => {
    const calls: Array<{ title: string; opts: NotificationOptions | undefined }> = [];
    class Fake {
      static permission = "granted";
      onclick: (() => void) | null = null;
      constructor(title: string, opts?: NotificationOptions) { calls.push({ title, opts }); }
      close() {}
    }
    const g = globalThis as unknown as { window?: unknown; Notification?: unknown };
    const prev = { window: g.window, Notification: g.Notification };
    g.window = { Notification: Fake, focus() {} };
    g.Notification = Fake;
    try {
      expect(showDesktopNotice(TEST_NOTICE)).toBe(true);
    } finally {
      g.window = prev.window;
      g.Notification = prev.Notification;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBe("Cortex test");
    expect(calls[0]?.opts?.tag).toBe("cortex-test");
  });
});
