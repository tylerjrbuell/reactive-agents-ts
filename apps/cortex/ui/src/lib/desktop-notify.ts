/**
 * desktop-notify.ts — the one path every desktop (OS) notification takes.
 *
 * Settings · Notifications picks a level; live events (a run ending, an
 * approval or a question waiting on the user) become a {@link DesktopNotice};
 * {@link shouldNotify} decides, from the level, the browser permission and
 * whether Cortex is on screen, whether it is shown. {@link createDesktopNotifier}
 * adds a per-key dedupe; {@link showDesktopNotice} is the only place that calls
 * `new Notification(...)` (the Settings "Send a test" button uses it too).
 *
 * Preferences are read at fire time (never a snapshot), and the decision does
 * not depend on the `notificationsEnabled` flag (it is only written by the
 * Settings form, so a browser permission granted earlier would never notify).
 */
import type { CortexSettings } from "./stores/settings.js";

/** What happened that may deserve a desktop notification. */
export type NotifyKind = "run-finished" | "run-failed" | "approval-needed" | "question-asked";

/** One notification, whatever raised it. */
export interface DesktopNotice {
  readonly kind: NotifyKind;
  /** Stable per thing (run, gate, interaction): the same key notifies once. */
  readonly key: string;
  readonly title: string;
  readonly body?: string;
  /** Where clicking the notification goes. */
  readonly href?: string;
}

/** Where Cortex is right now, as far as notifying is concerned. */
export interface NotifyEnv {
  readonly permission: NotificationPermission | "unsupported";
  /** `document.hidden`: the tab is in the background. */
  readonly hidden: boolean;
  /** `document.hasFocus()`: false when another window has focus. */
  readonly focused: boolean;
}

/** Whether a notice is shown, and why not. */
export type NotifyDecision =
  | { readonly notify: true }
  | { readonly notify: false; readonly reason: "level" | "permission" | "visible" | "duplicate" };

type Level = CortexSettings["notificationLevel"];

const LEVEL_KINDS: Readonly<Record<Level, readonly NotifyKind[]>> = {
  none: [],
  failures: ["run-failed"],
  // A run blocked on the user is the most valuable notification, so it is in the default level.
  completions: ["run-finished", "run-failed", "approval-needed", "question-asked"],
  all: ["run-finished", "run-failed", "approval-needed", "question-asked"],
};

/**
 * Whether `kind` should raise a desktop notification. Suppressed on purpose when
 * the level excludes it, the browser has not granted permission, or Cortex is
 * the focused, visible tab (the in-app toasts and panels already show it).
 */
export function shouldNotify(kind: NotifyKind, level: Level, env: NotifyEnv): NotifyDecision {
  if (!LEVEL_KINDS[level].includes(kind)) return { notify: false, reason: "level" };
  if (env.permission !== "granted") return { notify: false, reason: "permission" };
  if (!env.hidden && env.focused) return { notify: false, reason: "visible" };
  return { notify: true };
}

/** The browser's current notification environment (call at fire time). */
export function browserNotifyEnv(): NotifyEnv {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { permission: "unsupported", hidden: false, focused: true };
  }
  return {
    permission: Notification.permission,
    hidden: document.hidden,
    focused: document.hasFocus(),
  };
}

/**
 * Show a notice through the browser. The only `new Notification` call in Cortex.
 * Returns whether the browser accepted it (false if unsupported or it threw).
 */
export function showDesktopNotice(notice: DesktopNotice, onOpen?: (href: string) => void): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  try {
    const n = new Notification(notice.title, {
      ...(notice.body ? { body: notice.body } : {}),
      icon: "/favicon.svg",
      tag: notice.key,
    });
    n.onclick = () => {
      window.focus();
      if (notice.href) onOpen?.(notice.href);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** The notice the Settings "Send a test" button shows (same path as a real event). */
export const TEST_NOTICE: DesktopNotice = {
  kind: "run-finished",
  key: "cortex-test",
  title: "Cortex test",
  body: "Notifications are working.",
};

export interface DesktopNotifierDeps {
  /** Current level, read at each offer. */
  readonly getLevel: () => Level;
  readonly getEnv: () => NotifyEnv;
  readonly show: (notice: DesktopNotice) => void;
}

export interface DesktopNotifier {
  /** Offer a notice: shown at most once per key, when {@link shouldNotify} allows. */
  readonly offer: (notice: DesktopNotice) => NotifyDecision;
}

const SEEN_CAP = 500;

/** A notifier that dedupes by key and applies {@link shouldNotify} with live preferences. */
export function createDesktopNotifier(deps: DesktopNotifierDeps): DesktopNotifier {
  const seen = new Set<string>();
  return {
    offer(notice) {
      if (seen.has(notice.key)) return { notify: false, reason: "duplicate" };
      const decision = shouldNotify(notice.kind, deps.getLevel(), deps.getEnv());
      // A suppressed notice is not marked seen: a later, hidden moment may still deserve it.
      if (!decision.notify) return decision;
      seen.add(notice.key);
      if (seen.size > SEEN_CAP) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      deps.show(notice);
      return decision;
    },
  };
}
