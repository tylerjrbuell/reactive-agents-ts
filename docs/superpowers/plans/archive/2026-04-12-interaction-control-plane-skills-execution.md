# Interaction Control Plane & Governed Skills — Master Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan **task-by-task**. Steps use checkbox (`- [ ]`) syntax for tracking.

> **North star:** Ship an **external interaction and learning loop** that fits Reactive Agents: **policy-first ingress**, **durable sessions**, **observable decisions**, **eval-governed skill evolution**, and **optional chat-shaped UX** (slash, voice, DMs)—**not** a port of any single competitor. Hermes-style products are **inspiration** for jobs-to-be-done; architecture and differentiation are **RA-native** (Effect layers, EventBus, gateway `PolicyEngine`, four-layer memory, verification/eval, identity/interaction packages).

**Goal:** (1) **Interaction control plane** — channels + gateway so every inbound signal is a **typed envelope** → policy → budget → routing → execution → delivery, with **trace IDs** and **replay-friendly** boundaries. (2) **Governed living skills** — distillation and promotion under **validation, lineage, tiered injection, and rollback**, tied to **tests or eval hooks** where possible—not unbounded “self-improve.” (3) **Operator and migration ergonomics** — discoverable intents, safe DM entry, structured **import transforms** from common agent layouts (including Hermes/OpenClaw-style trees) **without** claiming feature parity.

**Architecture:** **Gateway** remains the **deterministic orchestrator** (`PolicyEngine`, scheduler, token/action budgets). **`@reactive-agents/channels`** (`docs/superpowers/specs/2026-03-11-channels-design.md`) owns **adapter lifecycle, triggers, SessionBridge, SQLite-backed session recovery**, with **`AgentSessionFactory` injected from runtime** (no `@reactive-agents/runtime` dependency inside channels — breaks cycles). **Slash / voice / pairing** are **thin surfaces** that feed the same **intent and policy** path as webhooks and crons. **Skills** interoperate with **community-shaped** frontmatter where useful, but **promotion is gated** by validators + confidence + optional eval regression—not filesystem alone.

**Tech stack:** TypeScript, Effect-TS, Bun tests, SQLite, `@reactive-agents/gateway`, `@reactive-agents/runtime`, `@reactive-agents/reactive-intelligence`, `@reactive-agents/memory`, Cortex ingest for live ops.

**Inspiration (optional read):** External notes (e.g. Copilot `hermes-patterns-research.md`) are **non-authoritative**. Commit a short **“inspiration digest”** to `docs/superpowers/specs/inspiration-external-agents-digest.md` if you want shared history; the **matrix below** is the contract.

---

## Child plans (execute in order — unchanged technical backbone)

| Order | Plan | Owns |
|------|------|------|
| 1 | `docs/superpowers/plans/2026-03-22-channels-package.md` | `@reactive-agents/channels` scaffold, ChannelService, TriggerRegistry, SessionBridge, webhook adapter, gateway `channels` → `accessControl` rename, runtime `.withChannels()`, EventBus events |
| 2 | `docs/superpowers/plans/2026-03-22-skill-loop-and-subagent-fixes.md` | Skill fragment → procedural entry, learning engine wiring, sub-agent result quality |
| 3 | `docs/superpowers/plans/2026-03-22-platform-adapters.md` | Bun/Node portability for DB/HTTP/process — consult if CI or deploy **requires Node** for channel persistence tests |
| 4 | **This file** | RA-specific interaction layer: **intent router**, voice ingress, DM gate, **policy-only approvals**, skill **artifact governance**, **cross-session recall** (memory + verification posture), **workspace import** CLI |

**Spec:** `docs/superpowers/specs/2026-03-11-channels-design.md`

### Approved spec deviations (child plan 1 — authoritative until spec amended)

1. **No `@reactive-agents/runtime` in `@reactive-agents/channels`** — use `AgentSessionFactory` (or equivalent) from `packages/runtime` at startup.
2. **`TriggerRegistry`** — synchronous default impl per child plan 1 where it diverges from spec’s Effect-first `TriggerSource` wording.
3. **`SessionBridge.resolve` params** — may exceed spec’s minimal `ExternalIdentity`; update design spec when TypeScript API freezes.

---

## Capability matrix — inspiration → RA realization

Use when writing acceptance tests and docs. Each row should gain **Status**, **Evidence (path:test)**, **Owner PR** in the living matrix file.

| Inspiration (job-to-be-done) | Why it matters | **Reactive Agents realization** (go further than a clone) | Owner |
|------------------------------|----------------|-------------------------------------------------------------|--------|
| Long-lived gateway + adapters | Always-on agents | **Same process owns policy + transport**; every hop emits **structured lifecycle events** for Cortex/traces — *ingress is data, policy decides fate* | Child plan 1 |
| “Unified commands” | Discoverable ops | **Intent router**: `/…` is one renderer; optional future **NL → same internal `Intent` ADT**; **capability manifest** (what this deploy can do) vs hard-coded bot commands | **S1** |
| Voice in chat | Richer input | **Typed media path** + optional STT **Effect**; explicit failure if unset; **retention/minimization** called out in guardrails/docs | **S2** |
| Sticky sessions | Continuity | **SessionBridge + SQLite** + **opt-in sticky policy**; continuity is **structured state** (checkpoints, tool outcomes), not one giant transcript | Child plan 1 + policy |
| DM safety | Abuse reduction | **Pairing + accessControl**; sessions **not** created until policy says so | **S3** |
| Sensitive ops | Human gate | **`PolicyEngine` only** — namespaced `requireApprovalFor` (e.g. `slash:usage`); channels **never** duplicates policy semantics | **S4** |
| Scheduled nudges | Habit + reflection | **Crons + workspace docs** (Cortex/CLI); tie to **observable** scheduled events | Defer mini-spike |
| Skills after hard tasks | Compounding learning | **execution-engine → RI → procedural store** with **telemetry** (child plan 2) | Child plan 2 |
| Skill quality over time | Trust | **Validator + lineage + confidence tier + promotion/rollback**; optional **eval regression** before widen injection | Child plan 2 + **S5** |
| “Search my history” | Recall | **Memory layers + FTS** + **summarization under budget**; pull through **verification** when claims matter | **S6** |
| Long-horizon user prefs | Personalization | Prefer **interaction / explicit preference signals** over opaque profile blobs — **Deferred spike** | Deferred |
| Tool expansion without redeploy | Velocity | **MCP + manifests**: health, versioning, sandbox class — *capability supply chain*, not anonymous plug-in pile | Docs + examples |
| Import from other agents | Adoption | **`rax workspace-import --dry-run`**: Effect-style **transform → validate → JSON plan → idempotent apply**; Hermes/OpenClaw as **source adapters**, not the product name | **S7** |
| Safe execution | Security | **Terminal/sandbox** docs linked from gateway/channel runbooks | Docs |

---

## Design principles (RA-native — non-negotiables)

1. **Deterministic policy, observable execution** — No “magic” routing; policy decisions are **logged and replay-scoped** where feasible.
2. **Channels surface intent; gateway commits decisions** — Keeps a **single enforcement story** for webhooks, crons, heartbeats, and chat.
3. **Skills are governed artifacts** — No broad auto-inject without **schema + budget + lineage**; promotion ties to **S5** gates.
4. **Inspiration ≠ parity** — Matrix tracks **jobs**, not “Hermes feature list.” Tier-1 surfaces (if used) are **defined in the living matrix**, not copied from another product.

---

## Current repo facts

- **Living matrix path:** `docs/spec/docs/interaction-capabilities-matrix.md` (alongside other specs under `docs/spec/docs/`).
- `packages/channels/` **does not exist yet** — child plan 1 remains authoritative for scaffold.
- `GatewayConfigSchema` still nests **sender access control** under `channels` (~`packages/gateway/src/types.ts`); child plan 1 renames to **`accessControl`** and reserves **`channels`** for transport.
- `GatewayEventSourceSchema` includes `"channel"` — use consistently for transport-originated events.

---

## Dependency graph

```
Task A (baseline + interaction-capabilities matrix)
    ↓
Child plan 1 — channels Phase 1
    ↓
Supplementary blocks S1–S4 (intent, voice, DM gate, approval) — S2/S3 may parallel after S1 once InboundMessage is stable
    ↓
Child plan 2 — skill loop
    ↓
S5–S7 + docs/benchmarks — governance, recall, workspace import; define “tier-1 surfaces” in matrix if needed
```

**Optional parallelism:** Child plan 2 may start after Task A only if `execution-engine.ts` merge risk is managed; **default: sequential** after child plan 1.

---

## File structure

### New (after `packages/channels` exists)

| File | Responsibility |
|------|------------------|
| `packages/channels/src/intent/operator-intent-router.ts` | Map `/command` text → internal **intent** ADT (not “Hermes commands” naming in code) |
| `packages/channels/src/intent/operator-intents.ts` | Canonical intents + help strings |
| `packages/channels/tests/intent/operator-intent-router.test.ts` | Router tests |
| `packages/channels/src/security/dm-pairing.ts` | Pairing lifecycle |
| `packages/channels/tests/security/dm-pairing.test.ts` | Pairing tests |
| `packages/channels/src/media/voice-inbound.ts` | Voice attachment + optional STT hook |
| `docs/spec/docs/interaction-capabilities-matrix.md` | Living matrix (this table + status columns) |

### Modified (as plans land)

| File | What changes |
|------|----------------|
| `packages/gateway/tests/types.test.ts` | Gateway config **migration anchor** for `accessControl` rename (Task A) |
| `packages/gateway/src/types.ts` | `accessControl` / transport `channels` per spec |
| `packages/runtime/src/builder.ts` | `.withChannels()`, factory injection |
| `packages/runtime/src/execution-engine.ts` | Run completion → learning (child plan 2) |
| `apps/cortex/server/services/ingest-service.ts` | Channel health / queue depth (later) |

---

## Task A: Baseline inventory (blocking — 1 PR)

**Files:**

- Create: `docs/spec/docs/interaction-capabilities-matrix.md`
- Modify: `packages/gateway/tests/types.test.ts`

- [ ] **Step A1:** Copy the **capability matrix** from this plan into `interaction-capabilities-matrix.md`; add columns `Status`, `Evidence (path:test)`, `Owner PR`.

- [ ] **Step A2:** Append migration-anchor `describe` (same as before — rename test title to RA plan):

```typescript
describe("Interaction control plane — gateway config shape", () => {
  test("sender access control still lives under channels until channels package rename (spec: accessControl)", () => {
    const roundTrip = Schema.decodeUnknownSync(GatewayConfigSchema)({
      channels: { accessPolicy: "open" },
    });
    expect(roundTrip.channels?.accessPolicy).toBe("open");
  });
});
```

- [ ] **Step A3:** `bun test packages/gateway/tests/types.test.ts --timeout 15000` — expect PASS pre-rename.

- [ ] **Step A4:** Grep inventory documented in matrix (`GatewayEventSource`, `source: "channel"`, `withGateway`).

- [ ] **Step A5:** Commit: `docs(test): interaction capabilities matrix and gateway config migration anchor`

---

## Task B: Child plan 1 — channels Phase 1

Follow `docs/superpowers/plans/2026-03-22-channels-package.md` in order.

- [ ] **B1:** Complete through Phase 1 checklist.

- [ ] **B2:** Golden path test: signed POST → `InboundMessage` → policy → stub reply → `sendMessage` with **idempotency key**. Record test name in matrix.

---

## Task C: Child plan 2 — skill loop

Follow `docs/superpowers/plans/2026-03-22-skill-loop-and-subagent-fixes.md`.

- [ ] **C1/C2:** As in child plan; update matrix rows for procedural learning.

---

## Task block S1: Operator intent router (slash as one surface)

**Depends on:** Task B (`InboundMessage` stable).

**Files:** `packages/channels/src/intent/operator-intent-router.ts`, `operator-intents.ts`, `tests/intent/operator-intent-router.test.ts`

- [ ] **S1.1:** Failing tests: map `/new` → `sessionReset`, `/model x` → `modelSwitch`, unknown → `help`.

- [ ] **S1.2:** `bun test packages/channels/tests/intent/operator-intent-router.test.ts --timeout 15000` — FAIL then implement.

- [ ] **S1.3:** Implement minimal intents: `new`, `reset`, `model`, `retry`, `undo`, `compress`, `usage`, `skills`, `status` (extend as manifest grows).

- [ ] **S1.4:** Wire into `ChannelService`: **(1)** `TriggerRegistry` user `slash_command` wins; **(2)** else built-in intent router; **(3)** else conversational path. Document in matrix.

- [ ] **S1.5:** Commit: `feat(channels): operator intent router for external surfaces`

---

## Task block S2: Voice ingress (hook)

**Files:** `packages/channels/src/media/voice-inbound.ts`, tests.

- [ ] **S2.1:** `VoiceAttachment` + optional `transcribeVoice` Effect; default **typed error** if unset.

- [ ] **S2.2:** Tests for error path + mock transcript path; one-line **data handling** note for production (link guardrails / retention policy in matrix).

---

## Task block S3: DM pairing gate

**Files:** `packages/channels/src/security/dm-pairing.ts`, tests.

- [ ] **S3.1:** SQLite `channel_pairings` + issue/verify.

- [ ] **S3.2:** Integrate with `accessControl` — no session until verified.

---

## Task block S4: Approval as policy

**Files:** `packages/gateway/src/types.ts`, `packages/gateway/src/services/policy-engine.ts`, `packages/channels/tests/policy/command-approval.test.ts`

- [ ] **S4.1:** Extend `requireApprovalFor` namespace convention `slash:…`.

- [ ] **S4.2:** Hold path emits observable event; test with synchronous approval stub.

---

## Task block S5: Skill artifact governance

**Files:** `packages/reactive-intelligence/src/skills/skill-artifact-metadata.ts` (or `agentskills-metadata.ts` if you prefer interop naming), tests; tie-in `packages/memory/src/services/skill-store.ts`.

- [ ] **S5.1:** Strict vs warn validation for skill frontmatter.

- [ ] **S5.2:** Promotion requires validator + confidence tier; document thresholds in **interaction-capabilities matrix**.

---

## Task block S6: Cross-session recall

**Files:** under `packages/memory/` per existing FTS/session APIs; `packages/memory/tests/session-recall-summary.test.ts` (name as appropriate).

- [ ] **S6.1:** Summarization over a session window using **test `LLMService` layer** — no network.

- [ ] **S6.2:** When API is stable, document in `apps/docs` per `AGENTS.md` workflow; note where **verification** should run for high-stakes recall.

---

## Task block S7: Workspace import (`rax workspace-import`)

**Files:** `apps/cli/`, `apps/cli/tests/workspace-import-plan.test.ts`

- [ ] **S7.0:** Fixture temp dir (e.g. `skills/foo/SKILL.md`, `MEMORY.md`); `--dry-run` emits JSON `{ version, sources, actions[] }` — schema asserted in test.

- [ ] **S7.1:** Detect **pluggable source layouts** (document in matrix); initial adapter: “generic skills tree + markdown memory files.”

- [ ] **S7.2:** Idempotent apply to skill store; **Hermes/OpenClaw**-shaped trees as **additional adapters later**, not blocking v1.

---

## Verification (release gate)

| Gate | Proof |
|------|--------|
| Architecture | Matrix links **test names** for ingress → **policy** → session → outbound |
| Reliability | Child plan 1 queue, restart, dedupe/idempotency tests green |
| Learning | Child plan 2 integration green; **S5** gates promotion |
| Safety | S3 + S4 + S5 strict path + injection budget tests green |
| Product fit | Matrix states **non-goals** (no parity claims); **tier-1 surfaces** defined if messaging ships broadly |

---

## Self-review

1. Jobs in matrix map to Task A / S1–S7 / child plans 1–2.
2. Steps name files, commands, and first tests where applicable.
3. Amend `2026-03-11-channels-design.md` to match **Approved spec deviations** before scaling contributor count.

---

## Execution handoff

**Plan:** `docs/superpowers/plans/2026-04-12-interaction-control-plane-skills-execution.md`

**1. Subagent-driven** — one slice per Task A, B chunk, S-block.

**2. Inline** — `executing-plans` with checkpoints after A, child plan 1, child plan 2, then S5–S7.
