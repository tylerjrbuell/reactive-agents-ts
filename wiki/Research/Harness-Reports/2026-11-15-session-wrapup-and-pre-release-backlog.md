---
type: report
status: active
created: 2026-11-15
tags: [harness, release, backlog, channels, ablation]
---

# Session wrap-up and pre-release backlog (2026-11-15)

## Shipped and verified (all gates 36/36 at `61c62561c`)
- Gateway/channels: model ack prefetch, 12 s bound (max 30 s), `ackLatencyMs` on the event and in the Cortex feed, `/new` reset, failed-turn notice (`failureNotice`), hub edits `turnTimeoutMs`/`failureNotice`.
- Chat path: no cross-conversation last-run leak, no direct-chat temperature override, runtime intent readers classify the current turn only (`extractIntentText`).
- Kernel: loop-detection state progress + graduated guidance, fail-fast on broken tools, SideEffectLanded clause scoping, duplicateGuard no longer nests its own note.
- Instrument: attribution canonical tool names, rw-3/rw-6 graders loosened, lh-1 receives search keys from the repo `.env` (campaign worktrees had none, so web-search fell back to DuckDuckGo).
- Measurement: 11-model campaign, live verification pass, enumerate-audit k=6 (inconclusive, no regression evidence). See `2026-11-13-local-model-campaign/`.

## Ablation wrap-up
No new mechanism was ablated this window; no default flipped. Arms still owed (each needs k>=6 and a stated rule before running):
- `leanThinking` on/off: qwen3:14b, qwen3:4b, deepseek-r1 (control gemma4:12b). Accept only if timeouts drop >=3pp with no accuracy loss. Verify r1 driver mode is native-fc first.
- `actOrAnswer: "auto"` on deepseek-r1 and cogito with controls.
- Compute-offload guidance (use `code-execute` for arithmetic): the biggest measured quality loss (46% of missed items were retrieved-but-wrong).
- lh-1 re-run with the search key to confirm `web-search` returns ok:true. Earlier lh-1 results (fail-fast, honest failure) were measured without a working search tool.
- Pre-fix rw-3/rw-6 and lh-1 cells are not comparable to post-fix cells.

## High-leverage work before the next release
1. Answer quality in accepted runs: compute offload; verify figures against data; enumerated input files compiled into evidence-basis requirements (stops writing the audit before reading inv-12). Fabrication veto ships advisory-softfail (`runner-terminal-verify-gate.ts`).
2. `http-get` returns 404 "Page not found" bodies as successes (inflates success counts, lets the model wander): tools-warden.
3. Typed `currentTurn` in task metadata instead of marker parsing; `execution-engine.ts:233` telemetry category still reads full text; no lint stops new `extractTaskText` calls in intent paths.
4. Run-completed output keeps the model's raw mid-thought after a fail-fast exit.
5. A2A: client `apiKey` sends `X-API-Key` but server accepts only Bearer; discovery uses plain fetch (no timeout/DNS pin); private-network default allow (owner decision pending).
6. Release hygiene: triage ~231 pending changesets, `bun run release:dry` while the bench is idle, 3 stashes and dirty worktree `agent-a16dda432f457125a`, `/tmp` `cortex-*`/`ra-test-traces-*` dirs.
7. Hub editor still hides `priority`, `groups`, `deniedReply`, `conversationIds` (preserved on save).

## Deferred (waiting on GPU/owner, not blocking release)
- enumerate-audit at k>=20 per SHA (about 1.5 h GPU) only if a kernel change implicates it.
- Ollama 0.40.16 upgrade (owner moved on), per-turn thinking budget field, gpt-oss calibration probe, `onModelDigestStale` event forwarding.
