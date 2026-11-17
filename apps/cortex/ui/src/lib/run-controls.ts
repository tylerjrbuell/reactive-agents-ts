/**
 * What Pause and Stop tell the person once the server has answered. The framework ends a
 * live durable run at its next step and saves where it was (`agent.pauseRun` /
 * `stopRun`), so the answer says whether the run can be continued (`persisted`): a run
 * that is not using Durable runs is only stopped. Pure wording; the requests live in
 * `stores/chat-stream.ts` (chat) and `stores/run-store.ts` (desk runs).
 */

/** A toast to show: tone, title and one plain line. */
export interface InterruptToast {
  readonly tone: "success" | "warning";
  readonly title: string;
  readonly detail: string;
}

/** What the server answered to Pause / Stop (`persisted`: the run was saved so Continue works). */
export type InterruptAnswer = { readonly ok: true; readonly persisted: boolean; readonly stopped?: boolean } | { readonly ok: false };

/**
 * The toast for a Pause or Stop. `where` is where Continue shows up ("under the reply" for
 * chat, "on the Runs page" for a desk run).
 */
export function interruptToast(kind: "pause" | "stop", answer: InterruptAnswer, where: string): InterruptToast {
  const done = kind === "pause" ? "Paused" : "Stopped";
  if (!answer.ok) return { tone: "warning", title: `Could not ${kind} the run`, detail: "The server did not answer. Try again." };
  if (answer.stopped === false) return { tone: "warning", title: "Nothing was running", detail: "The run had already ended." };
  if (answer.persisted) return { tone: "success", title: done, detail: `Continue picks up where it left off, ${where}.` };
  return {
    tone: "warning",
    title: "Stopped",
    detail: "This run is not using Durable runs, so there is nothing to continue from. Turn on Durable runs (Lab · Execution) to pause and continue.",
  };
}

/** The chat Pause toast: Continue appears under the reply. */
export const pauseToast = (answer: InterruptAnswer): InterruptToast => interruptToast("pause", answer, "under the reply");

/** Read the server's Pause / Stop answer (`{ ok, persisted }`); a refusal or a body that is not JSON is `{ ok: false }`. */
export async function interruptAnswerOf(res: Response): Promise<InterruptAnswer> {
  if (!res.ok) return { ok: false };
  const body = (await res.json().catch(() => ({}))) as { persisted?: unknown };
  return { ok: true, persisted: body.persisted === true };
}

/** The desk-run Pause / Stop toast: Continue shows on the Runs page. */
export const deskInterruptToast = (kind: "pause" | "stop", answer: InterruptAnswer): InterruptToast =>
  interruptToast(kind, answer, "from the Runs page");
