/**
 * Schedules facade: `agent.schedules()`.
 *
 * Promise view of the gateway's durable `ScheduleRegistry` (list / get / create /
 * update / pause / resume / remove / runNow / lastResult) for dashboards and APIs
 * such as Cortex. Effect-typed at the module boundary; the single Promise boundary
 * is the shared `runFacadeEffect` bridge. Rejects with `ScheduleUnavailableError`
 * when the agent was built without `.withGateway()`, and with the registry's own
 * tagged errors (`ScheduleNotFoundError`, `ScheduleStoreError`) otherwise.
 */

import { Effect, Option, type Context, type ManagedRuntime } from 'effect'
import type {
    ScheduleRegistry as ScheduleRegistryTag,
    SchedulerService as SchedulerServiceTag,
    Schedule,
    ScheduleInput,
    SchedulePatch,
} from '@reactive-agents/gateway'
import { ScheduleUnavailableError } from '../errors.js'
import { runFacadeEffect } from './run-facade-effect.js'

type Registry = Context.Tag.Service<typeof ScheduleRegistryTag>
type Scheduler = Context.Tag.Service<typeof SchedulerServiceTag>

/** Services the facade reads from the agent runtime. */
export type SchedulesRuntimeR =
    | Context.Tag.Identifier<typeof ScheduleRegistryTag>
    | Context.Tag.Identifier<typeof SchedulerServiceTag>

/** Handle to a manual fire: the event is queued and runs on the next gateway tick. */
export interface ScheduleRunRequest {
    readonly scheduleId: string
    readonly fireId: string
}

/** Promise API returned by `agent.schedules()`. */
export interface SchedulesApi {
    readonly list: () => Promise<readonly Schedule[]>
    readonly get: (id: string) => Promise<Schedule>
    readonly create: (input: ScheduleInput) => Promise<Schedule>
    readonly update: (id: string, patch: SchedulePatch) => Promise<Schedule>
    readonly pause: (id: string) => Promise<Schedule>
    readonly resume: (id: string) => Promise<Schedule>
    readonly remove: (id: string) => Promise<void>
    /** Queue an immediate run; it executes on the next gateway tick through the inbound queue. */
    readonly runNow: (id: string) => Promise<ScheduleRunRequest>
    readonly lastResult: (id: string) => Promise<Schedule['lastRun']>
}

/** Build the schedules API over an agent runtime. */
export const makeSchedulesApi = (
    runtime: ManagedRuntime.ManagedRuntime<SchedulesRuntimeR, never>,
    gatewayEnabled: boolean,
): SchedulesApi => {
    const withServices = <A, E>(
        f: (registry: Registry, scheduler: Scheduler) => Effect.Effect<A, E>,
    ): Promise<A> =>
        runFacadeEffect(
            runtime,
            Effect.gen(function* () {
                if (!gatewayEnabled) {
                    return yield* new ScheduleUnavailableError({
                        message: 'Schedules require .withGateway()',
                    })
                }
                const gw = yield* Effect.promise(() => import('@reactive-agents/gateway'))
                const registry = yield* Effect.serviceOption(gw.ScheduleRegistry)
                const scheduler = yield* Effect.serviceOption(gw.SchedulerService)
                if (Option.isNone(registry) || Option.isNone(scheduler)) {
                    return yield* new ScheduleUnavailableError({
                        message: 'Gateway schedule registry is not in the runtime',
                    })
                }
                return yield* f(registry.value, scheduler.value)
            }),
        )

    return {
        list: () => withServices((r) => r.list()),
        get: (id) => withServices((r) => r.get(id)),
        create: (input) => withServices((r) => r.create(input)),
        update: (id, patch) => withServices((r) => r.update(id, patch)),
        pause: (id) => withServices((r) => r.pause(id)),
        resume: (id) => withServices((r) => r.resume(id)),
        remove: (id) => withServices((r) => r.remove(id)),
        runNow: (id) =>
            withServices((_r, s) =>
                s.runNow(id).pipe(
                    Effect.map((event) => ({
                        scheduleId: String(event.metadata['scheduleId']),
                        fireId: String(event.metadata['fireId']),
                    })),
                ),
            ),
        lastResult: (id) => withServices((r) => r.lastResult(id)),
    }
}
