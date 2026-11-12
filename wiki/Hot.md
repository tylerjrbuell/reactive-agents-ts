---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-11-12
---

# Hot (Recent Context Cache)

**Purpose:** last-session state. Read first. ≤500 words. Older entries live in `wiki/Log.md`.

---

## 2026-11-12 — Cortex + gateway overhaul landed on `dev`

- **Multimodal:** `TaskInput = string | ContentPart[]` (text/image/audio/file) through `run/runStream/chat/AgentSession`; `modelInputCapabilities()`; typed `UnsupportedModalityError`; providers send or placeholder. Guide: `guides/multimodal.mdx`.
- **Cortex:** rich final answer + deliverables, `@` file tagging (realpath-confined), attachments, voice (browser or OpenAI-compatible STT/TTS; Speaches presets), composer redesign (`/mcp`, `/btw`, Config popover), judgment (Jev, Ollama Cloud keys; Lab Judgment; Judgments tab), eval rubric graders, Host/Origin request guard (`CORTEX_ALLOWED_HOSTS`).
- **Gateway** (owner: `gateway-warden`, covers gateway/channels/a2a/docker/deploy): canonical `ChannelAdapter` + `runAdapterConformance`, native Signal and Telegram adapters, durable `ScheduleRegistry` (catch-up policy, crash-safe fires), ingress server, bounded inbound queue, deploy hardening. **BREAKING:** `allowedSenders`/`blockedSenders` need a `platform:` prefix.
- **Ollama Cloud:** `resolveOllamaTarget` is the one place; ambient `OLLAMA_API_KEY` goes only to https / ollama.com.
- **Design specs (not built):** `wiki/Architecture/Design-Specs/2026-11-12-cortex-workflows.md` (new `@reactive-agents/workflow`), `...-plugin-system.md` (`@reactive-agents/plugin`); decisions in `wiki/Decisions/2026-11-12-*.md`.
- **Open owner decisions:** `wiki/Decisions/2026-11-12-open-owner-decisions.md`; workflows naming/Q7/Q8–Q11; whether the root test preload strips provider keys (only Cortex tests do now).

## Standing traps

- **Stale dist:** `bun rax cortex` loads `apps/cortex/dist`. Run `bun run build:apps` after source changes, or use dev mode.
- **Build order:** channels type-checks against gateway's built output; rebuild gateway first.
- **`packages/reasoning` exports `dist`:** rebuild after `src` edits.
- **Cortex memory dirs:** unnamed sub-agent memory dirs piled up (26k); pruned 2026-11-12. Sub-agent ids are now `sub-<parent>-<name>`.
- **Canonical sources:** sequencing `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`; debt `wiki/Architecture/DEBT-REGISTER.md`; agent rules `AGENTS.md`; memory index `.agents/MEMORY.md`.

## Earlier

- 2026-11-05: Plan 9 Phase 1 closed; per-run state on one FiberRef; strategy switching opt-in. Wardens became a plugin with a one-file team (`.claude/wardens.yaml`). See `wiki/Log.md`.
