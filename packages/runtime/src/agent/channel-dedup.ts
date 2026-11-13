/**
 * Delivery-keyed dedup for the legacy channel subscriber.
 *
 * Suppresses the SAME delivery arriving twice (an echo or sync copy of one platform message), not
 * a user who sends identical text again. The key is the delivery identity (sender, platform
 * timestamp, text), so a repeat gets a new timestamp and passes. Entries expire by `Clock` on the
 * next lookup; there is no timer per message.
 */
import { Clock, Effect, Ref } from 'effect'

/** Seen-set with time-based expiry. */
export interface DeliveryDedup {
    /** `true` when `key` was seen within the TTL (a duplicate); otherwise records it and returns `false`. */
    readonly seen: (key: string) => Effect.Effect<boolean>
}

/** Create a dedup whose entries expire `ttlMs` after first sight. */
export const makeDeliveryDedup = (ttlMs: number): Effect.Effect<DeliveryDedup> =>
    Effect.map(Ref.make(new Map<string, number>()), (ref) => ({
        seen: (key) =>
            Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis
                return yield* Ref.modify(ref, (entries) => {
                    const live = new Map(
                        [...entries].filter(([, expiresAt]) => expiresAt > now)
                    )
                    const duplicate = live.has(key)
                    if (!duplicate) live.set(key, now + ttlMs)
                    return [duplicate, live] as const
                })
            }),
    }))

/** Delivery identity of a channel message: sender, platform timestamp, text. */
export const deliveryKey = (event: {
    readonly sender: string
    readonly timestamp: number
    readonly message: string
}): string => `${event.sender}:${event.timestamp}:${event.message}`
