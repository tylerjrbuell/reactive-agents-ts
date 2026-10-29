---
type: harness-report
status: partial
created: 2026-10-29
tags: [cortex, browser-verification, goals, loops, plan-4, C1, D6]
---

# Goals/loops browser verification (Plan 4 C1 + D6)

Tool: Playwright MCP (claude-in-chrome `navigate` was blocked by site permissions). Target: user's dev stack at `localhost:5173/chat`, model ollama `llama3.2:3b`. Server process started 10:46:59; commit `f131fec0b` (10:48:42, resume from stalled/blocked) landed after, so the running server was stale for that change.

## (a) Composer layout

| Item | Result | Evidence |
|---|---|---|
| Card layout | PASS | Chips row, to-do dock, textarea share the card; x-extents 300-940 at 1400px, no overflow |
| Provider chip opens /provider picker | PASS | Listbox lists 8 providers, current marked; picking ollama updated the chip |
| Model chip opens /model picker | PASS | Lists local ollama models, thinking models tagged |
| Prompt-library popover beside its button, on-screen | PASS | 1400px: x309-692, y692-845, button top 849. 420px: x21-404, inside viewport |
| To-do dock aligned | PASS | Dock x300-940 matches textarea x301-939 |
| Dark + light | PASS | Both screenshotted; popover rendered in both |
| 420px resize | PASS | scrollWidth 420 = viewport, no horizontal scroll |

Observation (not fixed, by design?): the turn inspector is open by default and, below ~1024px, covers the composer with a backdrop that intercepts clicks until closed.

## (b) /goal

| Item | Result | Evidence |
|---|---|---|
| propose | PASS | "Proposed: waiting for your accept", Accept/Cancel shown |
| accept -> segments | PASS | Ran 2 segments, segment meter 2/5 |
| honest verdict | PASS | Rubric criterion shows "not yet decided"; `verdictHistory` is `[null,null]`, never a faked pass |
| pause | PASS | API 200, status paused |
| cancel | PASS | API 200, status cancelled |
| resume | NOT-VERIFIED | Paused: 409 because the segment was still finishing (by design). Stalled: 409 "goal is stalled, not paused", the stale-server symptom; source allows it |
| tiny-budget exhaustion | PASS | `maxSegments:1` -> `budget-exhausted`, reason "budget exhausted: maxSegments", verdict null |
| chat 409 while active | PASS | `409 Session is pursuing a goal ... Pause or cancel the goal to chat.` (a send after the segment finished returned 200) |
| real rubric checker | PASS | Checker returned null verdicts with llama3.2:3b (no crash) |

Defects (owned by others, not fixed):
1. ChatGoalBar: Resume/Cancel on a 409 gives no visible feedback; the button silently does nothing. Needs an error toast or disabled state.
2. Running server predates `f131fec0b`; restart needed to verify resume-from-stalled.

## (c) /loop, /schedule

| Item | Result | Evidence |
|---|---|---|
| /loop 1m fires when idle | PASS | schedule `runs:1, lastStatus:ok` at ~74s; the "pong" turn is in the history after reload. It did not appear live in the open page |
| /schedule create | PASS | cron created, chip shown |
| /schedule list | PASS | toast "2 SCHEDULES" with 8-char ids |
| /schedule rm | FAIL then FIXED | Used the 8-char id from `list`; server DELETE with the prefix returned 404. Fixed in `chat-goal-commands.ts` to resolve the prefix (and report no match / ambiguous). Re-verified: schedule removed |
| chip removal | PASS | Remove button deleted the schedule server-side and the chip disappeared |

## (d) Other

| Item | Result | Evidence |
|---|---|---|
| /docs bad-URL failure banner | PASS | `/docs add http://localhost:1/nope.md`, then a send: banner "1 document could not be loaded ... blocked private host". Bare `/docs <url>` is not a command form (needs `add`) |
| Run trace tab | PASS | Copy JSONL / Download .jsonl, frames and final answer render |
| Export | NOT-VERIFIED | Button enabled; download not triggered (would write a file) |
| Cost after reload | NOT-VERIFIED | Tokens persist (54k) but ollama cost is $0.0000, so a non-zero persisted cost was not exercised |
| Strategy switch in chat | NOT-VERIFIED | Not exercised; would need a reasoning-strategy change and a capable model |
| Sub-agent block | NOT-VERIFIED | Not exercised; llama3.2:3b emitted tool-call JSON as text and cannot drive sub-agents |

## Commits
- Fix: `00936a6c7` fix(cortex): /schedule rm accepts the id prefix shown by /schedule list
