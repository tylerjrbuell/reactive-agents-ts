---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-11-12
---

# Hot (Recent Context Cache)

**Purpose:** last-session state. Read first. ≤500 words. Older entries live in `wiki/Log.md`.

---

## 2026-11-12 — on `dev` (77 commits today)

- **Security pass:** shell sed/awk/find escapes closed, SSRF guard covers IPv6 mapped/NAT64/6to4 forms, one shared redaction list (exporter, logger, trace), owner-only file modes, CI actions pinned by SHA, Cortex asks before risky tools by default (opt-out), channels fail closed without `accessControl`, root test preload strips provider keys (`REACTIVE_AGENTS_TEST_LIVE=1` opts out).
- **Cortex UI:** Config popover merged with the slash menu, kit `Select`, live goal/loop output, channels + Gateway overview, speech coordinator and voice fixes, Speaches supervisor, desktop notifications, session-control capabilities, voice speed and spoken answers, structured `request_user_input` end to end, web-search keys (Settings; reach agents via `withTools({ webSearch })`).
- **Channel routing:** `ChannelRouter` slice one, SessionBridge lifecycle, RouteMeter, `withChannels` routes, single consumer, history hygiene, Cortex channel hub H1 (server slice). Owner reports real Telegram verified. Spec: [[2026-11-12-channel-routing]]; decisions [[2026-11-12-channel-routing-decisions]]; trace diagnosis [[2026-11-12-telegram-gateway-trace-diagnosis]].
- **Kernel:** retrieval tools no longer count as landed side effects; iteration-0 satisfiability abstains when only read-only tools are visible.
- **Chat tool intent** is capability-based (`b64f9855b`); `.withToolIntent` takes capability (default), message or a classifier; wording regex deprecated.
- **In flight (uncommitted):** kernel tool-visibility fix; Cortex dropping its copies of framework code.

## Open

- **Hub H2 (UI) and chat-session targets:** [[2026-11-12-chat-session-channels]]. Owner chose owners-only, queue mid-turn, hold approvals for Cortex, full hub first.
- **Ablations pending** for three default changes (`bun run gate:check` before pushing defaults).
- **Framework gaps:** `defineTool` `mutatesExternalState` option, durable router store, self-target shorthand, sub-agent web-search key inheritance, `RouterStatus` per-channel error.
- **Security leftovers:** DNS-rebinding pinning, MCP read-only marking, signal-mcp SDK bump, ra-test-traces leak.
- **Unconfirmed:** live browser checks (Playwright was down). 229 changesets pending.
- **Owner decisions:** [[2026-11-12-open-owner-decisions]]; design specs [[2026-11-12-cortex-workflows]], [[2026-11-12-plugin-system]].

## Standing traps

- **Stale dist:** `bun rax cortex` loads `apps/cortex/dist`; run `bun run build:apps` or use dev mode.
- **Build order:** channels type-checks against gateway's built output.
- **`packages/reasoning` exports `dist`:** rebuild after `src` edits.
- **Sources:** `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`, `wiki/Architecture/DEBT-REGISTER.md`, `AGENTS.md`, `.agents/MEMORY.md`.

## Earlier

- 2026-11-05: Plan 9 Phase 1 closed; wardens became a plugin. See `wiki/Log.md`.
