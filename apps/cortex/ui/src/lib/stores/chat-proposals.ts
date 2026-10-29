import { writable, get } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import { chatGoalStore } from "$lib/stores/chat-goal.js";
import { chatStore } from "$lib/stores/chat-store.js";
import { effectsOf, type ProposalEffect, type ProposalWire } from "$lib/proposal-view.js";

/** Agent-session-control proposals of the active chat. Server is the source of truth; this is a read-through cache. */
export interface ChatProposalsState {
  readonly sessionId: string | null;
  readonly proposals: readonly ProposalWire[];
  /** Ids with an apply/dismiss request in flight. */
  readonly busy: readonly string[];
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Re-read hooks run after a successful apply so goal bar, schedules and session config reflect it. */
export type ProposalRefresh = (sessionId: string, effects: readonly ProposalEffect[]) => void | Promise<void>;

export class ProposalApplyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function createChatProposalsStore(fetchFn: Fetch = (url, init) => fetch(url, init), refresh: ProposalRefresh = () => {}) {
  const store = writable<ChatProposalsState>({ sessionId: null, proposals: [], busy: [] });
  const base = (sid: string) => `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sid)}/proposals`;
  /** Ignore a response that arrives after the user switched sessions. */
  const current = (sid: string) => get(store).sessionId === sid;

  function reset(sid: string | null) {
    store.set({ sessionId: sid, proposals: [], busy: [] });
  }

  async function load(sid: string): Promise<readonly ProposalWire[]> {
    const res = await fetchFn(base(sid));
    if (!res.ok) throw new Error(`Failed to load proposals (${res.status})`);
    const { proposals } = (await res.json()) as { proposals?: ProposalWire[] };
    const list = proposals ?? [];
    if (current(sid)) store.update((s) => ({ ...s, proposals: list }));
    return list;
  }

  const merge = (sid: string, next: ProposalWire) => {
    if (current(sid)) store.update((s) => ({ ...s, proposals: s.proposals.map((p) => (p.id === next.id ? next : p)) }));
  };
  const setBusy = (id: string, on: boolean) =>
    store.update((s) => ({ ...s, busy: on ? [...s.busy, id] : s.busy.filter((b) => b !== id) }));

  async function act(sid: string, id: string, verb: "apply" | "dismiss"): Promise<ProposalWire> {
    setBusy(id, true);
    try {
      const res = await fetchFn(`${base(sid)}/${encodeURIComponent(id)}/${verb}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as { proposal?: ProposalWire; error?: string };
      if (res.status === 409) {
        // Already resolved elsewhere (another tab): resync rather than show a dead error.
        await load(sid).catch(() => {});
        throw new ProposalApplyError(body.error ?? "Proposal is no longer pending", 409);
      }
      if (res.status === 422) {
        // Apply failed server-side; the proposal stays proposed with `error` set.
        if (body.proposal) merge(sid, body.proposal);
        else await load(sid).catch(() => {});
        throw new ProposalApplyError(body.proposal?.error ?? body.error ?? "Apply failed", 422);
      }
      if (!res.ok || !body.proposal) throw new ProposalApplyError(body.error ?? `Request failed (${res.status})`, res.status);
      merge(sid, body.proposal);
      if (verb === "apply") await refresh(sid, effectsOf(body.proposal.action));
      return body.proposal;
    } finally {
      setBusy(id, false);
    }
  }

  return {
    subscribe: store.subscribe,
    snapshot: () => get(store),
    reset,
    load,
    apply: (sid: string, id: string) => act(sid, id, "apply"),
    dismiss: (sid: string, id: string) => act(sid, id, "dismiss"),
  };
}

/** Default wiring: re-read whichever store the applied action can have changed. */
export const chatProposalsStore = createChatProposalsStore(undefined, async (sid, effects) => {
  const jobs: Promise<unknown>[] = [];
  if (effects.includes("goal")) jobs.push(chatGoalStore.loadGoal(sid));
  if (effects.includes("schedules")) jobs.push(chatGoalStore.loadSchedules(sid));
  if (effects.includes("config")) jobs.push(chatStore.loadSessions());
  await Promise.allSettled(jobs);
});
