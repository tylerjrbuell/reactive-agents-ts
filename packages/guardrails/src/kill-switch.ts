import { Effect, Context, Layer, Ref, Deferred } from "effect";
import { EventBus } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

/**
 * KillSwitchService — emergency stop for agent execution.
 *
 * When triggered, the execution engine will halt at the next phase
 * transition and return a TaskResult with the kill reason.
 */
export class KillSwitchService extends Context.Tag("KillSwitchService")<
  KillSwitchService,
  {
    /** Trigger the kill switch for an agent. Execution halts at next phase boundary. */
    readonly trigger: (agentId: string, reason: string) => Effect.Effect<void>;
    /** Check if the kill switch has been triggered for an agent. */
    readonly isTriggered: (agentId: string) => Effect.Effect<{ triggered: boolean; reason?: string }>;
    /** Clear the kill switch for an agent (re-enable execution). */
    readonly clear: (agentId: string) => Effect.Effect<void>;
    /** Trigger a global kill switch — halts ALL agents. */
    readonly triggerGlobal: (reason: string) => Effect.Effect<void>;
    /** Check if global kill switch is active. */
    readonly isGlobalTriggered: () => Effect.Effect<{ triggered: boolean; reason?: string }>;
    /** Clear the global kill switch. */
    readonly clearGlobal: () => Effect.Effect<void>;
    /** Pause agent execution at the next phase boundary (blocks until resume). */
    readonly pause: (agentId: string) => Effect.Effect<void>;
    /** Resume a paused agent. */
    readonly resume: (agentId: string) => Effect.Effect<void>;
    /** Signal agent to stop gracefully at the next phase boundary. */
    readonly stop: (agentId: string, reason: string) => Effect.Effect<void>;
    /** Immediately terminate agent (also triggers kill switch). */
    readonly terminate: (agentId: string, reason: string) => Effect.Effect<void>;
    /** Get the current lifecycle state for an agent. */
    readonly getLifecycle: (agentId: string) => Effect.Effect<"running" | "paused" | "stopping" | "terminated" | "unknown">;
    /**
     * If paused, block until resumed. Emits AgentPaused when blocking starts and
     * AgentResumed when unblocked — so events carry the real taskId from the
     * execution context rather than a synthetic "lifecycle" placeholder.
     * Returns "stopping" if stop() was called while paused, else "ok".
     */
    readonly waitIfPaused: (agentId: string, taskId: string) => Effect.Effect<"ok" | "stopping">;
  }
>() {}

export const KillSwitchServiceLive = () =>
  Layer.effect(
    KillSwitchService,
    Effect.gen(function* () {
      const agentKills = yield* Ref.make<Map<string, string>>(new Map());
      const globalKill = yield* Ref.make<string | null>(null);
      const lifecycleRef = yield* Ref.make<Map<string, "running" | "paused" | "stopping" | "terminated">>(new Map());
      const pauseDeferreds = yield* Ref.make<Map<string, Deferred.Deferred<void>>>(new Map());

      // EventBus is optional — publish lifecycle events when available
      const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      const eb = ebOpt._tag === "Some" ? ebOpt.value : null;

      return KillSwitchService.of({
        trigger: (agentId, reason) =>
          Ref.update(agentKills, (m) => {
            const newMap = new Map(m);
            newMap.set(agentId, reason);
            return newMap;
          }),

        isTriggered: (agentId) =>
          Effect.gen(function* () {
            // Global takes precedence
            const globalReason = yield* Ref.get(globalKill);
            if (globalReason != null) {
              return { triggered: true, reason: globalReason };
            }
            const kills = yield* Ref.get(agentKills);
            const reason = kills.get(agentId);
            return reason != null
              ? { triggered: true, reason }
              : { triggered: false };
          }),

        clear: (agentId) =>
          Ref.update(agentKills, (m) => {
            const newMap = new Map(m);
            newMap.delete(agentId);
            return newMap;
          }),

        triggerGlobal: (reason) => Ref.set(globalKill, reason),

        isGlobalTriggered: () =>
          Effect.gen(function* () {
            const reason = yield* Ref.get(globalKill);
            return reason != null
              ? { triggered: true, reason }
              : { triggered: false };
          }),

        clearGlobal: () => Ref.set(globalKill, null),

        pause: (agentId) =>
          Effect.gen(function* () {
            const d = yield* Deferred.make<void>();
            yield* Ref.update(pauseDeferreds, (m) => {
              const n = new Map(m);
              n.set(agentId, d);
              return n;
            });
            yield* Ref.update(lifecycleRef, (m) => {
              const n = new Map(m);
              n.set(agentId, "paused");
              return n;
            });
            // AgentPaused is emitted from waitIfPaused() so it carries the real
            // taskId from the execution context and fires exactly when execution blocks.
          }),

        resume: (agentId) =>
          Effect.gen(function* () {
            const deferreds = yield* Ref.get(pauseDeferreds);
            const d = deferreds.get(agentId);
            if (d) {
              yield* Deferred.succeed(d, undefined);
              yield* Ref.update(pauseDeferreds, (m) => {
                const n = new Map(m);
                n.delete(agentId);
                return n;
              });
            }
            yield* Ref.update(lifecycleRef, (m) => {
              const n = new Map(m);
              n.set(agentId, "running");
              return n;
            });
            // AgentResumed is emitted from waitIfPaused() after the deferred resolves,
            // so it carries the real taskId and fires as execution actually unblocks.
          }),

        stop: (agentId, _reason) =>
          Ref.update(lifecycleRef, (m) => {
            const n = new Map(m);
            n.set(agentId, "stopping");
            return n;
          }),

        terminate: (agentId, reason) =>
          Effect.gen(function* () {
            yield* Ref.update(lifecycleRef, (m) => {
              const n = new Map(m);
              n.set(agentId, "terminated");
              return n;
            });
            yield* Ref.update(agentKills, (m) => {
              const n = new Map(m);
              n.set(agentId, reason);
              return n;
            });
          }),

        getLifecycle: (agentId) =>
          Ref.get(lifecycleRef).pipe(
            Effect.map((m) => (m.get(agentId) ?? "unknown") as "running" | "paused" | "stopping" | "terminated" | "unknown"),
          ),

        waitIfPaused: (agentId, taskId) =>
          Effect.gen(function* () {
            const lifecycle = yield* Ref.get(lifecycleRef).pipe(
              Effect.map((m) => m.get(agentId)),
            );
            if (lifecycle === "paused") {
              // Emit AgentPaused here — execution has reached a phase boundary and
              // is actually about to block, so the event carries the real taskId.
              if (eb) {
                yield* eb.publish({ _tag: "AgentPaused", agentId, taskId })
                  .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "guardrails/src/kill-switch.ts:175", tag: errorTag(err) })));
              }
              const deferreds = yield* Ref.get(pauseDeferreds);
              const d = deferreds.get(agentId);
              if (d) {
                yield* Deferred.await(d);
              }
              // Emit AgentResumed now — execution is actually continuing.
              if (eb) {
                yield* eb.publish({ _tag: "AgentResumed", agentId, taskId })
                  .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "guardrails/src/kill-switch.ts:185", tag: errorTag(err) })));
              }
            }
            const newLifecycle = yield* Ref.get(lifecycleRef).pipe(
              Effect.map((m) => m.get(agentId)),
            );
            return newLifecycle === "stopping" ? ("stopping" as const) : ("ok" as const);
          }),
      });
    }),
  );
