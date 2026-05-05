# Gateway State Tracking

The gateway maintains **zero-LLM-cost state** that powers all policy decisions. State is tracked in memory via `Ref<GatewayState>` and updated after every event evaluation.

## State Fields

```ts
interface GatewayState {
  readonly isRunning: boolean;
  readonly lastExecutionAt: Date | null;           // ← Enables adaptive skip
  readonly consecutiveHeartbeatSkips: number;      // ← Forces execute after N skips
  readonly tokensUsedToday: number;                // ← Enforces daily budget
  readonly actionsThisHour: number;                // ← Enforces rate limit
  readonly hourWindowStart: Date;                  // Window for rate limit
  readonly dayWindowStart: Date;                   // Window for budget
  readonly pendingEvents: readonly GatewayEvent[]; // Queued work
}
```

### `lastExecutionAt: Date | null`

**Purpose:** Enable adaptive heartbeat policy

**Updated:** When ANY event decision is `execute` (heartbeat, cron, webhook)

**Used by:** `AdaptiveHeartbeatPolicy` to skip idle ticks
- If `null` (never executed): execute immediately
- If set + `consecutive_skips < max`: skip when no pending events
- Resets on every execution → next heartbeat can skip again

**Example flow:**
```
1. Heartbeat fires, lastExecutionAt=null → EXECUTE (first run)
2. lastExecutionAt now set to ~now
3. Heartbeat fires again, no pending work → SKIP (no state change)
4. lastExecutionAt unchanged → still skipped on 3rd tick
5. After max skips (8) → FORCE EXECUTE regardless
```

---

### `consecutiveHeartbeatSkips: number`

**Purpose:** Safety net for adaptive mode — prevent indefinite skipping

**Updated:**
- Incremented +1 when heartbeat decision is `skip`
- Reset to 0 when heartbeat decision is `execute` or when other events execute

**Used by:** `AdaptiveHeartbeatPolicy`
```ts
if (state.consecutiveHeartbeatSkips >= maxConsecutiveSkips) {
  return null;  // Allow execution (force run)
}
```

**Default:** `maxConsecutiveSkips = 6`

**Example timeline (adaptive mode):**
```
Tick 1: execute (init)          → consecutiveSkips = 0
Tick 2: skip (idle)             → consecutiveSkips = 1
Tick 3: skip (idle)             → consecutiveSkips = 2
Tick 4: skip (idle)             → consecutiveSkips = 3
Tick 5: skip (idle)             → consecutiveSkips = 4
Tick 6: skip (idle)             → consecutiveSkips = 5
Tick 7: skip (idle)             → consecutiveSkips = 6
Tick 8: FORCE EXECUTE (max)     → consecutiveSkips = 0 (reset)
```

This ensures heartbeat runs **at minimum once per 8 ticks** even if silent.

---

### `tokensUsedToday: number`

**Purpose:** Track daily token consumption for cost budget enforcement

**Updated:** Incremented after every task execution
```ts
yield* Ref.update(stateRef, (s) => ({
  ...s,
  tokensUsedToday: s.tokensUsedToday + tokens,
}));
```

**Window:** Resets at midnight in the gateway `timezone`

**Used by:** `CostBudgetPolicy`
```ts
if (config.dailyTokenBudget && 
    state.tokensUsedToday >= config.dailyTokenBudget) {
  return { action: "skip", reason: "daily budget exhausted" };
}
```

**Example:**
```
dailyTokenBudget = 200_000
tokensUsedToday  = 185_000

Event fires → Would cost 20_000 tokens
185_000 + 20_000 = 205_000 > 200_000 → SKIP
```

---

### `actionsThisHour: number`

**Purpose:** Track action frequency for rate limiting

**Updated:** Incremented when ANY event (excluding heartbeat skip) executes
```ts
yield* Ref.update(stateRef, (s) => ({
  ...s,
  actionsThisHour: s.actionsThisHour + 1,
}));
```

**Window:** Resets when `hourWindowStart` is > 1 hour old

**Used by:** `RateLimitPolicy`
```ts
if (config.maxActionsPerHour && 
    state.actionsThisHour >= config.maxActionsPerHour) {
  return { action: "skip", reason: "rate limit exceeded" };
}
```

**Example:**
```
maxActionsPerHour = 60
actionsThisHour   = 58

Cron fires → 58 + 1 = 59 (within limit) → EXECUTE
Next webhook → 59 + 1 = 60 (at limit) → EXECUTE
Next heartbeat → 60 >= 60 → SKIP (rate limited)

After 1 hour window resets → actionsThisHour = 0
```

---

### `pendingEvents: readonly GatewayEvent[]`

**Purpose:** Queue events that arrive while execution is in-flight

**Updated:** Managed by event merging policy (webhooks only)

**Used by:** `AdaptiveHeartbeatPolicy`
```ts
const hasPendingEvents = state.pendingEvents.length > 0;

// If pending work exists, execute immediately
if (hasPendingEvents || hasNeverExecuted) {
  return null;  // Allow execution
}
```

---

## Policy Decision Chain

Policies are evaluated in order (lower priority = earlier):

```ts
const sorted = policies.sort((a, b) => a.priority - b.priority);

for (const policy of sorted) {
  const decision = policy.evaluate(event, state);
  if (decision !== null) {
    return decision;  // ← First match wins
  }
}
return { action: "execute" };  // Default
```

**Priority order:**
1. **AdaptiveHeartbeat** (priority=10) — policy mode + max consecutive skips
2. **CostBudget** (priority=20) — daily token limit
3. **RateLimit** (priority=30) — actions per hour
4. **EventMerging** (priority=40) — webhook deduplication
5. **AccessControl** (priority=50) — channel filtering

**Key:** State is immutable during evaluation, but policies see the _current_ state, so later policies can't override earlier ones.

---

## State Updates & Events

After a decision, state is updated based on action:

```ts
// Skip: increment consecutive skips (heartbeat only)
if (event.source === "heartbeat" && decision.action === "skip") {
  consecutiveHeartbeatSkips++
}

// Execute: reset consecutive skips, update lastExecutionAt
else if (decision.action === "execute") {
  consecutiveHeartbeatSkips = 0
  lastExecutionAt = now()
  actionsThisHour++
}
```

**Statistics published** (decoupled from state):
- `heartbeatsFired`, `heartbeatsSkipped`
- `tokensUsedToday` (also in state)
- `actionsThisHour` (also in state)
- `actionsSuppressed`, `actionsEscalated`

---

## Example: HN Gateway Monitor State Over Time

**Configuration:**
```ts
.withGateway({
  heartbeat: { intervalMs: 60_000, policy: "adaptive", maxConsecutiveSkips: 8 },
  crons: [{ schedule: "*/5 * * * *", instruction: "..." }],
  policies: {
    dailyTokenBudget: 200_000,
    maxActionsPerHour: 60,
  },
})
```

**Timeline:**

```
T=0s    | Heartbeat #1 fires
        | lastExecutionAt=null → EXECUTE (first run)
        | lastExecutionAt=T0, tokensUsedToday=1500, consecutiveSkips=0

T=60s   | Heartbeat #2 fires
        | No pending work, T0 is recent → SKIP (no state change)
        | consecutiveSkips=1, tokensUsedToday=1500

T=120s  | Heartbeat #3 fires
        | Still no pending work → SKIP
        | consecutiveSkips=2, tokensUsedToday=1500

T=180s  | Heartbeat #4 fires
        | Still no pending work → SKIP
        | consecutiveSkips=3, tokensUsedToday=1500

T=240s  | Heartbeat #5 fires
        | Still no pending work → SKIP
        | consecutiveSkips=4, tokensUsedToday=1500

T=300s  | Cron fires ("*/5 * * * *" matched)
        | Cron is independent of heartbeat policy → EXECUTE
        | Cron costs 2000 tokens → tokensUsedToday=3500
        | lastExecutionAt=T300, consecutiveSkips=0 (reset by action)
        | actionsThisHour=2

T=360s  | Heartbeat #6 fires (60s since last check)
        | T300 is recent, no pending → SKIP
        | consecutiveSkips=1, tokensUsedToday=3500

T=420s  | Cron fires again
        | → EXECUTE
        | tokensUsedToday=5500, actionsThisHour=3

T=540s  | Webhook arrives (user feedback)
        | Policy checks: tokens OK, rate OK → EXECUTE
        | tokensUsedToday=7000, actionsThisHour=4
        | pendingEvents clears after merge
```

---

## Inspecting State at Runtime

Use `.gatewayStatus()`:

```ts
const status = await agent.gatewayStatus();

console.log(status.state);
// {
//   isRunning: true,
//   lastExecutionAt: Date,
//   consecutiveHeartbeatSkips: 2,
//   tokensUsedToday: 5500,
//   actionsThisHour: 4,
//   hourWindowStart: Date,
//   dayWindowStart: Date,
//   pendingEvents: []
// }

console.log(status.stats);
// {
//   heartbeatsFired: 6,
//   heartbeatsSkipped: 3,
//   cronsExecuted: 2,
//   webhooksProcessed: 1,
//   totalTokensUsed: 5500,
//   actionsSuppressed: 0,
//   ...
// }
```

The HN gateway example now periodically logs state every 15 seconds in production mode, showing:
```
[State] hb_fired=6 hb_skipped=3 consecutive_skips=1 tokens=5500/200000 actions_this_hour=4 last_run=11:59:41
```

---

## Window Reset Logic

**Token window resets at midnight:**
```ts
const now = new Date();
const midnight = new Date(now);
midnight.setHours(24, 0, 0, 0);

if (now >= midnight) {
  dayWindowStart = now;
  tokensUsedToday = 0;
}
```

**Rate limit window resets after 1 hour:**
```ts
const elapsed = now - hourWindowStart;
if (elapsed > 3_600_000) {  // 1 hour
  hourWindowStart = now;
  actionsThisHour = 0;
}
```

Both resets happen automatically on state update if windows are stale.
