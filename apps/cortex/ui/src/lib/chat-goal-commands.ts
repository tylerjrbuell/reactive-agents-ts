import type { createChatGoalStore } from "$lib/stores/chat-goal.js";
import { goalView, parseGoalArg, parseLoopArg, parseScheduleArg, scheduleLabel } from "$lib/goal-view.js";

/** Where command results go; ChatPanel wires these to toasts. */
export interface GoalNotify {
  readonly ok: (title: string, detail?: string) => void;
  readonly info: (title: string, detail?: string) => void;
  readonly err: (title: string, detail?: string) => void;
}

type GoalStore = ReturnType<typeof createChatGoalStore>;

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Execute `/goal`, `/loop` or `/schedule`. Errors become `notify.err` (409 busy, 400 invalid, cap reached):
 * the server's message is shown verbatim. Returns once the server has answered.
 */
export async function runGoalSlash(
  name: "goal" | "loop" | "schedule",
  arg: string,
  sid: string,
  store: GoalStore,
  notify: GoalNotify,
): Promise<void> {
  try {
    if (name === "goal") {
      const c = parseGoalArg(arg);
      if (c.kind === "usage") return notify.info("Usage", "/goal <objective> | accept | pause | resume | cancel | status");
      if (c.kind === "propose") {
        await store.propose(sid, c.objective);
        return notify.ok("Goal proposed", "Review it above the input, then accept to start.");
      }
      if (c.kind === "status") {
        const g = await store.loadGoal(sid);
        if (!g) return notify.info("No goal in this chat");
        const v = goalView(g);
        return notify.info(v.statusLabel, `${v.verdictText} · ${g.segments}/${g.budget.maxSegments} segments`);
      }
      await store.transition(sid, c.kind);
      return notify.ok(`Goal ${c.kind === "accept" ? "accepted" : c.kind === "pause" ? "paused" : c.kind === "resume" ? "resumed" : "cancelled"}`);
    }
    if (name === "loop") {
      const c = parseLoopArg(arg);
      if (c.kind === "usage") return notify.info("Usage", "/loop <5m|1h|1d> <prompt> | /loop stop");
      if (c.kind === "start") {
        await store.createSchedule(sid, "loop", c.spec, c.prompt);
        return notify.ok(`Looping every ${c.spec}`, "Skipped while a turn is running. /loop stop to end it.");
      }
      const loops = (await store.loadSchedules(sid)).filter((s) => s.kind === "loop");
      if (loops.length === 0) return notify.info("No loop running");
      for (const s of loops) await store.removeSchedule(sid, s.id);
      return notify.ok(loops.length === 1 ? "Loop stopped" : `${loops.length} loops stopped`);
    }
    const c = parseScheduleArg(arg);
    if (c.kind === "usage") return notify.info("Usage", '/schedule "<m h dom mon dow>" <prompt> | list | rm <id>');
    if (c.kind === "create") {
      await store.createSchedule(sid, "cron", c.cron, c.prompt);
      return notify.ok("Scheduled", `${c.cron}: ${c.prompt}`);
    }
    if (c.kind === "remove") {
      await store.removeSchedule(sid, c.id);
      return notify.ok("Schedule removed");
    }
    const list = await store.loadSchedules(sid);
    if (list.length === 0) return notify.info("No schedules in this chat");
    return notify.info(`${list.length} schedule${list.length === 1 ? "" : "s"}`, list.map((s) => `${s.id.slice(0, 8)}  ${scheduleLabel(s)}`).join("\n"));
  } catch (e) {
    notify.err(`/${name} failed`, msg(e));
  }
}
