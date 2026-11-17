/**
 * desktop-notifier.ts — wires live Cortex events to desktop notifications.
 *
 * One app-wide notifier (`desktopNotifier`) reads the Settings level at fire
 * time. Sources, none of which depend on which page started the work
 * (server-started goal, loop and schedule turns included):
 * - a run ending: the layout's live-WS handler calls {@link notifyRunEnd};
 * - an approval or a question waiting on the user: {@link startDesktopNotifier}
 *   watches the shared `pendingApprovals` / `pendingInteractions` stores.
 */
import { createDesktopNotifier, browserNotifyEnv, showDesktopNotice, type DesktopNotice } from "../desktop-notify.js";
import { settings } from "./settings.js";
import { pendingApprovals, approvalToastMessage } from "./approval-watcher.js";
import { pendingInteractions } from "./interaction-watcher.js";
import type { RunEndToast } from "../run-toast.js";
import type { PendingApprovalWire } from "../waiting-on-you.js";
import type { PendingInteractionWire } from "@reactive-agents/ui-core";

let openHref: (href: string) => void = (href) => {
  if (typeof window !== "undefined") window.location.assign(href);
};

/** Let the app route a notification click (SvelteKit `goto`) instead of a full page load. */
export function setNotificationNavigator(fn: (href: string) => void): void {
  openHref = fn;
}

/** The app-wide notifier: live level, live browser state, the shared browser path. */
export const desktopNotifier = createDesktopNotifier({
  getLevel: () => settings.get().notificationLevel,
  getEnv: browserNotifyEnv,
  show: (notice) => void showDesktopNotice(notice, (href) => openHref(href)),
});

/** Notice for a run's end (the same `RunEndToast` the in-app toast uses). */
export function runEndNotice(end: RunEndToast): DesktopNotice {
  return {
    kind: end.kind === "error" ? "run-failed" : "run-finished",
    key: end.key,
    title: end.title,
    ...(end.message ? { body: end.message } : {}),
    href: end.href,
  };
}

/** Notice for an approval waiting on the user. */
export function approvalNotice(p: PendingApprovalWire): DesktopNotice {
  return {
    kind: "approval-needed",
    key: `approval:${p.runId}|${p.gateId}`,
    title: "Approval needed",
    body: approvalToastMessage(p),
    href: p.chatSessionId ? `/chat?session=${encodeURIComponent(p.chatSessionId)}` : `/run/${p.runId}`,
  };
}

/** Notice for a question (`request_user_input`) waiting on the user. */
export function questionNotice(i: PendingInteractionWire): DesktopNotice {
  return {
    kind: "question-asked",
    key: `question:${i.runId}|${i.interactionId}`,
    title: "An agent has a question",
    body: i.prompt.length > 120 ? `${i.prompt.slice(0, 120)}…` : i.prompt,
    href: `/run/${i.runId}`,
  };
}

/** Offer a run-end toast as a desktop notification. */
export function notifyRunEnd(end: RunEndToast): void {
  desktopNotifier.offer(runEndNotice(end));
}

/** Watch the pending approvals and questions. Returns the stop function. */
export function startDesktopNotifier(): () => void {
  const offA = pendingApprovals.subscribe((list) => {
    for (const p of list) desktopNotifier.offer(approvalNotice(p));
  });
  const offI = pendingInteractions.subscribe((list) => {
    for (const i of list) desktopNotifier.offer(questionNotice(i));
  });
  return () => {
    offA();
    offI();
  };
}
