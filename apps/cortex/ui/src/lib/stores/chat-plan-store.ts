/**
 * The active chat session's plan (the framework `Plan`, persisted by the server with the session).
 * Held per session id so a switch never shows another conversation's plan. The card refreshes it
 * when it appears and when a turn ends; an edit goes through `savePlan`, an import through
 * `importPlanText` (the server reads the framework's formats, the result is saved through the same
 * plan route), an export through `exportPlanAs`. Kept out of `chat-store.ts` (one concern each).
 */
import { derived, get, writable } from "svelte/store";
import { chatStore } from "./chat-store.js";
import { toast } from "./toast-store.js";
import { exportSessionPlan, fetchSessionPlan, parseSessionPlan, putSessionPlan, type CortexPlanWire } from "../plan-api.js";
import { toPlanBody, type DraftStep } from "../plan-edit.js";
import { extrasOfSteps, NO_EXTRAS, type ExtrasMap } from "../plan-extras.js";
import type { PlanFindingView } from "../plan-findings.js";
import { importFailureLine, importTextBlank, importTextTooLarge, type PlanExportItem } from "../plan-transfer.js";
import { saveTextFile } from "../chat-download.js";

/** Plans by session id; `null` = the server says there is none. */
const plans = writable<Readonly<Record<string, CortexPlanWire | null>>>({});

/** The active session's plan; `undefined` until loaded, `null` when it has none. */
export const chatPlan = derived([chatStore, plans], ([$chat, $plans]): CortexPlanWire | null | undefined =>
  $chat.activeSessionId === null ? undefined : $plans[$chat.activeSessionId],
);

/** Remember a session's plan (the server's answer to a read or an edit). */
export function setPlanFor(sessionId: string, plan: CortexPlanWire | null): void {
  plans.update((p) => ({ ...p, [sessionId]: plan }));
}

/** Re-read the active session's plan. A failed read keeps what is shown. */
export async function refreshChatPlan(): Promise<void> {
  const sid = get(chatStore).activeSessionId;
  if (sid === null) return;
  const res = await fetchSessionPlan(sid);
  if (res.ok) setPlanFor(sid, res.plan);
}

/** Save the edited steps (and their `dependsOn` / `args`) as the session's plan. Resolves true when the server recorded them. */
export async function savePlan(steps: readonly DraftStep[], goal?: string, extras: ExtrasMap = NO_EXTRAS): Promise<boolean> {
  const sid = get(chatStore).activeSessionId;
  if (sid === null) return false;
  const res = await putSessionPlan(sid, toPlanBody(steps, extras), goal);
  if (!res.ok) {
    toast.error("Could not save the plan", res.error);
    return false;
  }
  setPlanFor(sid, res.plan);
  return true;
}

/**
 * Keep the plan's steps and replace its recon findings (a removal drops one; `[]` clears them).
 * Resolves true when the server recorded the edit.
 */
export async function saveFindings(findings: readonly PlanFindingView[]): Promise<boolean> {
  const sid = get(chatStore).activeSessionId;
  const plan = sid === null ? undefined : get(plans)[sid];
  if (sid === null || !plan) return false;
  const res = await putSessionPlan(sid, toPlanBody(plan.steps, extrasOfSteps(plan.steps)), undefined, findings);
  if (!res.ok) {
    toast.error("Could not update the findings", res.error);
    return false;
  }
  setPlanFor(sid, res.plan);
  return true;
}

/** What an import did: the plan took the file's steps, or the person-readable reason it did not. */
export type ImportOutcome = { readonly ok: true; readonly steps: number } | { readonly ok: false; readonly message: string };

/**
 * Read `text` (Markdown or a JSON envelope) as a plan and make it the session's plan: the server
 * parses with the framework, then the plan is saved through the plan route as a user edit.
 * Nothing changes when the text cannot be read.
 */
export async function importPlanText(text: string): Promise<ImportOutcome> {
  const sid = get(chatStore).activeSessionId;
  if (sid === null) return { ok: false, message: "Open a chat first." };
  if (importTextBlank(text)) return { ok: false, message: "Paste a plan or choose a file first." };
  if (importTextTooLarge(text)) return { ok: false, message: "That file is too large to be a plan." };
  const parsed = await parseSessionPlan(sid, text);
  if (!parsed.ok) return { ok: false, message: importFailureLine(parsed) };
  // The file's `dependsOn` and `args` (the framework's portable formats carry them) ride with its steps.
  const res = await putSessionPlan(sid, toPlanBody(parsed.plan.steps, extrasOfSteps(parsed.plan.steps)), parsed.plan.goal);
  if (!res.ok) return { ok: false, message: res.error };
  setPlanFor(sid, res.plan);
  return { ok: true, steps: parsed.plan.steps.length };
}

/** Export the saved plan: copy its text or save it as a file. Failures toast. */
export async function exportPlanAs(item: PlanExportItem): Promise<void> {
  const sid = get(chatStore).activeSessionId;
  if (sid === null) return;
  const res = await exportSessionPlan(sid, item.format);
  if (!res.ok) return void toast.error("Could not export the plan", res.error);
  if (item.action === "download") {
    saveTextFile(res.text, res.filename, res.mime);
    return void toast.success("Plan saved", res.filename);
  }
  try {
    await navigator.clipboard.writeText(res.text);
    toast.success("Plan copied", "Markdown, ready to paste");
  } catch {
    toast.error("Could not copy", "The browser refused clipboard access");
  }
}
