# 2026-11-12 (evening) — Security hardening, channel routing, Cortex hub H1, capability chat intent

Source: `git log --since="2026-11-12 00:00"` (77 commits on `dev`).

- Security: shell sed/awk/find escapes, IPv6 SSRF forms, shared redaction, owner-only modes, SHA-pinned CI actions, Cortex ask-before-risky-tools default, channels fail closed, test preload strips provider keys (f3d96abc4).
- Cortex UI: Config popover + slash menu, kit Select, live goal/loop output, channels and Gateway overview, speech coordinator, Speaches supervisor, notifications, 14 session-control actions, voice speed and spoken answers, structured `request_user_input` (core to UI), web-search keys.
- Channels: router slice one (86eff8066), SessionBridge lifecycle and RouteMeter (d8c3978b3), `withChannels` routes (d47424258), single consumer and history hygiene (bec4b1a6e), Cortex hub H1 (5112dca74, 4e0ebd7fb). Specs: [[2026-11-12-channel-routing]], [[2026-11-12-chat-session-channels]]; diagnosis [[2026-11-12-telegram-gateway-trace-diagnosis]].
- Kernel: retrieval tools not counted as landed side effects (795a51884); read-only satisfiability abstention (1521de3f2).
- Runtime: chat tool intent is capability-based, `.withToolIntent` capability|message|classifier (b64f9855b).
- In flight, uncommitted: kernel tool-visibility fix; Cortex dropping framework copies.
- Open: hub UI H2 and chat-session targets (owner: owners-only, queue mid-turn, hold approvals for Cortex, full hub first); ablations pending for three default changes; framework gaps (defineTool `mutatesExternalState`, durable router store, self-target shorthand, sub-agent web-search key inheritance, RouterStatus per-channel error); security leftovers (DNS-rebinding pinning, MCP read-only marking, signal-mcp SDK bump, ra-test-traces leak); live browser checks unconfirmed (Playwright down); 229 pending changesets. Decisions: [[2026-11-12-open-owner-decisions]].

---

# 2026-11-12 — Cortex and gateway overhaul, review and hardening

Multimodal input, Cortex voice/judgment/rich answer/composer, canonical ChannelAdapter with native Signal and Telegram, durable ScheduleRegistry, ingress, inbound queue, deploy hardening, Ollama Cloud key scoping. Specs: `wiki/Architecture/Design-Specs/2026-11-12-cortex-workflows.md`, `...-plugin-system.md`. Decisions: `wiki/Decisions/2026-11-12-*.md`. Audit: `wiki/Research/Audit-Reports-2026-11-12/gateway-channels-deploy-audit.md`. New warden: `gateway-warden`. Breaking: `platform:` prefix on `allowedSenders`/`blockedSenders`. Follow-up: docs sweep, security audit.

---

# 2026-11-05 — Wardens: open-source plugin, one-file team, hook enforcement (warn mode)

Design: wiki/Architecture/Design-Specs/2026-11-05-wardens-pack-design.md. Decision: wiki/Decisions/2026-11-05-wardens-one-file-hook-enforced.md.

- Extracted the warden system to github.com/tylerjrbuell/wardens (Claude Code plugin, v0.3). Hooks: MissionBrief gate at dispatch, authority guard inside wardens, UpwardReport gate at stop, outcome ledger.
- PR #294 (merged): enforceable authority for all 10 wardens; gaps fixed (compose `test/` path, kernel tests unowned → `ownership.json` row, no `Write` tool, Harness-Reports claimed twice); 5 dead primer anchors and provider-warden's non-existent 7-hook contract repaired; contract v2 in `repo warden-report` (`needs-approval`, `reroute`, verification-backed confidence); 4 pre-existing `tools/repo` test failures and the broken stale-path PostToolUse hook fixed.
- Follow-up: the team moved into one file, `.claude/wardens.yaml` (via `warden migrate`, on top of 436ceca2's allowlists). Agent files are prompts only; `.wardens/` is the gitignored ledger. Wardens made `git stash/clean/reset --hard/checkout --/restore` built-in never-run after this repo's stash ban.
- AGENTS.md and Agents-Extended-Reference corrected: the pilot was never canonicalized by ablation; it was ratified 2026-09-03 on continued use.
- Open (Tyler): `warn` → `enforce`; 3 never-dispatched wardens (memory, compose, debrief-scribe); pilot log vs ledger; make the wardens repo public (CI `check-wardens` skips until then). Not verified: the hooks in a live Claude Code session.

---

# 2026-11-03 — Repo tool + declutter executed

Plan: wiki/Planning/Implementation-Plans/2026-11-03-dev-tool-determinism-and-declutter.md (executed; outcome verification pending session-stats). `bun run repo` CLI, PreToolUse hooks, placement rules, fast pre-commit checks, AGENTS.md reduced to a contract, `as unknown as` ceilings fixed. Hot.md rewritten.

---

# 2026-10-25 — Signal consumption edge shipped (root-cause closure of the signal gap)

Plan: wiki/Planning/Implementation-Plans/2026-10-25-signal-consumption-edge.md (status: EXECUTED).
Commits: 1023730e3 (schema) -> e6bef250a (ledger) -> 354a82d20 (emit/render/effect) -> fb84f7294 (tally) -> e12817b6a (normalize/RI/diagnose) -> d49ae89e8 (ratchet) -> 26305801a (docs) -> bedeaf288 (persistence fix).

What shipped:
- Trace schema: signal-rendered, signal-effect kinds; harness-signal-injected gains signalId/targetTool/targetPolicy; run-completed gains optional signals tally. Historical traces still load.
- Kernel: pure signal-ledger.ts + signal-effect.ts classifier; render stamps in think.ts; tally in run-finalize. RI projection gains signalStats; diagnose gains signal-gap-detector; probe crossCheck gains signal-unrendered bucket.
- End-to-end verified (run 01M5TD7GRGNS1HT6C90XQ4A2K3): signal-rendered (2), signal-effect (1, ignored), run-completed.signals tally {opened:1, rendered:1, ignored:1}. New blind-spot bucket signal-unrendered fired.

Carried / pending (P0-P5 + missing signals list) recorded in Hot.md section 2026-10-25 and Recommended-Enhancements.md.

---

# 2026-10-23 — Introspective harness improvement loop (bonsai-2:27b)

New probe mode shipped to harness-improvement-loop: agents interviewed outside the harness, self-reports cross-checked vs trace events. Six friction tasks ran; one fix shipped (ollama thinking off-switch, provider-warden — llm-provider 511/0); 11 scored items queued in Recommended-Enhancements.md §2026-10-23 (top: maxIterations tier-clamp theft, recovery-nudge wrong-tool advice, denials traced ok=true, terminal-gate blind spot, sandbox split-brain go/no-go). Evidence: wiki/Research/Harness-Reports/introspective-2026-10-24-02-*.

## 2026-10-25 — Cortex chat engine overhaul shipped (handoff)

- Shipped 20 commits on `dev`: runtime `initialHistory` + streamTurn recording; cortex chat on canonical engine; config parity + useReasoning deletion; UI tool chips/cancel/stop/retry; sync batch (coverage guard, skill strip, MCP OAuth, withHarness, RAG ingest, withers decision doc); changeset.
- Gates: cortex server 330/0, UI 121/0, runtime chat 77/0, typecheck 69/69, build 35/35. Dispatch-logging test fixed.
- Pending (documented, NOT fixed): cortex correctness + performance (user-reported). Suspected: cached-agent/MCP container lifetime, density:"full" always, store reducer scale, per-turn normalize/build cost. Stale-dist trap documented.
- Durable artifacts: spec (implemented), plan (completed), debrief (this file's sibling), decision doc, Hot.md entry.

---

# 2026-10-29 — Plans vs shipped audit; docs/changeset/wiki truth pass

- Audit: wiki/Research/Audit-Reports-2026-10-29/plans-vs-shipped.md. All three 2026-10-28 plans flipped to completed (plan 3: Phase 1); Planning-Index rows updated.
- Docs fixed: features/cortex.mdx (to-do default on for new chat sessions; dock; ring; model link; Beacon), reference/builder-api.md (`observability.checklist`, `todo`, `todoGuidance`, session `initialTodo`), features/llm-providers.md (live model discovery), CAPABILITIES.md (`todo`), `.changeset/checklist-primitive.md`.
- Debt filed: D-2026-10-29-CHILD-COST. Browser verification recorded in Harness-Reports.
- Hot.md regenerated; .agents/MEMORY.md updated.
