import { writable, get } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import type { GoalAction, GoalWire, ScheduleWire } from "$lib/goal-view.js";

/** Goal + schedules of the active chat session. Server is the source of truth; this is a read-through cache. */
export interface ChatGoalState {
  readonly sessionId: string | null;
  readonly goal: GoalWire | null;
  /** Server's reason for the goal's latest status transition (e.g. why it blocked), or null. */
  readonly reason: string | null;
  readonly schedules: readonly ScheduleWire[];
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createChatGoalStore(fetchFn: Fetch = (url, init) => fetch(url, init)) {
  const store = writable<ChatGoalState>({ sessionId: null, goal: null, reason: null, schedules: [] });
  const base = (sid: string) => `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sid)}`;

  async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetchFn(url, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return body;
  }
  const post = (body?: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  /** Ignore a response that arrives after the user switched sessions. */
  const apply = (sid: string, patch: Partial<ChatGoalState>) =>
    store.update((s) => (s.sessionId === sid || s.sessionId === null ? { ...s, sessionId: sid, ...patch } : s));

  /** Switch session: clear stale state first so another chat's goal never flashes. */
  function reset(sid: string | null) {
    store.set({ sessionId: sid, goal: null, reason: null, schedules: [] });
  }

  async function loadGoal(sid: string): Promise<GoalWire | null> {
    const { goal, reason } = await call<{ goal: GoalWire | null; reason?: string | null }>(`${base(sid)}/goal`);
    apply(sid, { goal, reason: reason ?? null });
    return goal;
  }
  async function propose(sid: string, objective: string): Promise<GoalWire> {
    const { goal, reason } = await call<{ goal: GoalWire; reason?: string | null }>(`${base(sid)}/goal`, post({ objective }));
    apply(sid, { goal, reason: reason ?? null });
    return goal;
  }
  async function transition(sid: string, action: GoalAction): Promise<GoalWire> {
    const { goal, reason } = await call<{ goal: GoalWire; reason?: string | null }>(`${base(sid)}/goal/${action}`, post());
    apply(sid, { goal, reason: reason ?? null });
    return goal;
  }
  async function loadSchedules(sid: string): Promise<readonly ScheduleWire[]> {
    const { schedules } = await call<{ schedules: ScheduleWire[] }>(`${base(sid)}/schedules`);
    apply(sid, { schedules });
    return schedules;
  }
  async function createSchedule(sid: string, kind: "loop" | "cron", spec: string, prompt: string): Promise<ScheduleWire> {
    const { schedule } = await call<{ schedule: ScheduleWire }>(`${base(sid)}/schedules`, post({ kind, spec, prompt }));
    await loadSchedules(sid);
    return schedule;
  }
  async function removeSchedule(sid: string, id: string): Promise<void> {
    await call(`${base(sid)}/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadSchedules(sid);
  }

  return {
    subscribe: store.subscribe,
    snapshot: () => get(store),
    reset, loadGoal, propose, transition, loadSchedules, createSchedule, removeSchedule,
  };
}

export const chatGoalStore = createChatGoalStore();
