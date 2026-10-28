/**
 * A2A executor result mapping.
 *
 * Extracted verbatim from `ReactiveAgent.serveA2A()`: maps a resolved
 * `run()` result onto the A2A executor's `Effect<string, A2AError>` seam.
 */
import { Effect } from 'effect'
import { A2AError } from '@reactive-agents/a2a'
import type { AgentResult } from '../builder/types.js'

/**
 * A graceful `success: false` decline (abstention, fabrication-guard rejection,
 * empty-output-no-deliverable) must surface to an A2A caller as a failed task,
 * not `state: "completed"`.
 */
export const a2aResultToEffect = (result: AgentResult): Effect.Effect<string, A2AError> => {
    // `run()`'s documented contract (see agent/run-contract.ts): abstention, fabrication-guard rejection, and
    // empty-output-no-deliverable all resolve with `success: false`
    // WITHOUT throwing — the agent completed and was graded, not a
    // runtime failure. If this executor only read `.output`, those
    // graceful declines would surface to an A2A caller as
    // `state: "completed"`, indistinguishable from a real answer.
    // Branch on `success` and fail the Effect so
    // `createTaskHandler`'s `Effect.catchAll` (task-handler.ts)
    // maps it to `state: "failed"` instead.
    if (result.success) return Effect.succeed(result.output)

    const message =
        result.error ??
        (result.abstention
            ? `Agent declined to complete the task: ${result.abstention.reason}`
            : result.output.length > 0
              ? result.output
              : 'Agent declined to complete the task')

    // No dedicated "agent declined" code exists in A2AError's
    // code family (see errors.ts) and the finding's constraint is
    // not to invent one. `INTERNAL_ERROR` is the same generic
    // bucket `ReactiveAgent.serveA2A`'s executor `catch` already uses for
    // genuine execution failures, and what `A2AError.parse`
    // defaults to — reusing it keeps the code space unchanged;
    // `message` carries the distinguishing content.
    return Effect.fail(
        new A2AError({
            code: 'INTERNAL_ERROR',
            message,
        }),
    )
}
