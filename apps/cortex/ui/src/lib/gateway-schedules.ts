/**
 * Lab · Channels schedules and queue: edits to `gateway.crons` and `gateway.queue`.
 * A cron here is a framework schedule (`ScheduleRegistry`): it fires the instruction through the
 * gateway while the agent's channels are up, and its next fire and history show in the Gateway
 * overview. (The Saved agents cron is a separate, simpler one-shot trigger.)
 */
import type { GatewayBlock } from "./channel-access.js";

/** One framework cron entry as saved. */
export type CronEntry = NonNullable<GatewayBlock["crons"]>[number];

const FIELD = /^(\*|\d+)([-/,]\S*)?$|^[A-Za-z]{3}([-,/][A-Za-z0-9]+)*$|^\*\/\d+$/;

/** Why a cron expression cannot be used, or null. Five whitespace-separated fields; the framework parses the rest. */
export function cronProblem(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (expr.trim() === "") return "Enter a cron expression, like 0 9 * * 1.";
  if (parts.length !== 5) return "A cron expression has five fields: minute, hour, day of month, month, day of week.";
  if (!parts.every((p) => FIELD.test(p))) return "Each field is a number, *, a list (1,15), a range (1-5) or a step (*/10).";
  return null;
}

/** `gateway` with its crons replaced; an empty list is dropped, and an empty block with it. */
function withCrons(gateway: GatewayBlock | undefined, crons: readonly CronEntry[]): GatewayBlock | undefined {
  const next: GatewayBlock = { ...(gateway ?? {}) };
  if (crons.length > 0) next.crons = [...crons];
  else delete next.crons;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Add a schedule. Returns the problem instead when the expression or the instruction is unusable. */
export function addCron(
  gateway: GatewayBlock | undefined,
  input: { readonly schedule: string; readonly instruction: string },
): { readonly gateway: GatewayBlock | undefined } | { readonly problem: string } {
  const schedule = input.schedule.trim().replace(/\s+/g, " ");
  const problem = cronProblem(schedule);
  if (problem) return { problem };
  const instruction = input.instruction.trim();
  if (!instruction) return { problem: "Say what the agent should do when it fires." };
  return { gateway: withCrons(gateway, [...(gateway?.crons ?? []), { schedule, instruction }]) };
}

/** Remove the schedule at `index`. */
export const removeCron = (gateway: GatewayBlock | undefined, index: number): GatewayBlock | undefined =>
  withCrons(gateway, (gateway?.crons ?? []).filter((_, i) => i !== index));

/** Turn the schedule at `index` on or off without removing it. */
export const setCronEnabled = (gateway: GatewayBlock | undefined, index: number, enabled: boolean): GatewayBlock | undefined =>
  withCrons(gateway, (gateway?.crons ?? []).map((c, i) => (i === index ? { ...c, enabled } : c)));

/** `gateway` with the inbound queue bounds set; both unset drops the queue (the framework defaults apply). */
export function withQueue(
  gateway: GatewayBlock | undefined,
  queue: { readonly capacity?: number | undefined; readonly overflow?: "drop-oldest" | "drop-newest" | undefined },
): GatewayBlock | undefined {
  const next: GatewayBlock = { ...(gateway ?? {}) };
  const capacity = queue.capacity !== undefined && Number.isInteger(queue.capacity) && queue.capacity > 0 ? queue.capacity : undefined;
  if (capacity !== undefined || queue.overflow) next.queue = { ...(capacity !== undefined ? { capacity } : {}), ...(queue.overflow ? { overflow: queue.overflow } : {}) };
  else delete next.queue;
  return Object.keys(next).length > 0 ? next : undefined;
}
