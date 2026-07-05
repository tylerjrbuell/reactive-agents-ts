# 08 — The Canonical Agentic OS (North Star v6.0)

> **Status:** Ratified direction (2026-07-05). Successor to `05-DESIGN-NORTH-STAR.md` §6 for forward sequencing; the 8 pillars of `00-VISION.md` remain the constitution and are NOT amended — this spec is how they get fully realized.
>
> **One line:** Reactive Agents stops being a framework and becomes an **operating system for cognition** — runs are processes, execution history is version control, trust is a type, the runtime learns the model it drives, and every run can improve the platform. The model is the CPU; RA is everything that made CPUs usable.

---

## 0. Provenance and evidence

This spec is grounded in a 10-subsystem deep audit (2026-07-05, two sweeps of 5 parallel read-only explorers) covering: reasoning kernel + strategies, runtime/compose control surface, tools/MCP/memory/multi-agent, replay/observe/eval, llm-provider/calibration, reactive-intelligence, gateway/channels/a2a/orchestration, cortex/CLI/DX surfaces, ui-kit on main, and a safety-net inventory sweep (37 packages, 6 apps, env-flag census). Plus a mid-2026 competitive landscape research pass (TS framework positioning, AG-UI/MCP/A2A standards state, local-model reliability state, community unmet needs).

Key external anchors (mid-2026):
- **Verification is the #1 unmet need** — "the 2026 bottleneck is verification capacity, not generation speed." Nobody owns in-runtime verification/receipts; Braintrust owns eval-as-SaaS only.
- **Durable execution is table stakes** (Mastra DurableAgent, LangGraph checkpoints, Vercel Workflow DevKit) — no longer a differentiator alone; RA's durable rail is the substrate, not the story.
- **The 14B tool-calling gap closed at the model level** (Qwen3 14B ≈ GPT-4 on agent-loop evals). The unmet need shifted to a **harness that makes any model reliable** (sub-7B, untrained, unknown fine-tunes) — a framework concern RA is uniquely positioned on.
- **UI bindings are commoditized** by AG-UI/TanStack AI/CopilotKit. Defensible = durable-run-backed interaction *semantics*, not adapters.
- Self-improving agents: research-stage everywhere; no productized TS implementation. RA's replay + lift-gate + ledger make it the only credible (measured) form available.

---

## 1. The master finding: a last-mile problem, not a capability problem

Across all 10 maps, one pattern dominates: **nearly every ambitious subsystem is 70–90% built with the final wiring missing.** The declared surface exceeds the executing surface. This is simultaneously the framework's biggest honesty debt and its cheapest growth reserve.

| Subsystem | Built | Missing last mile | Anchor |
|---|---|---|---|
| A2A mesh | Protocol, agent cards, discovery, capability matcher, JSON-RPC+SSE server, all unit-tested | Executor never bridged to the agent; `A2AHttpServer.start()` never called by builder; streaming stubbed → cross-machine collaboration dead end-to-end | `a2a/src/runtime.ts:8`, `task-handler.ts:46` |
| Flywheel contribution | `RunReport.skillFragment` wire field, skill synthesis, distiller | Field never populated → skills never reach the platform API | `telemetry-emit.ts:209-257` |
| Trust events to UI | `TrustEvent`/`StepEvent`/`UiTreeDelta`/`ObjectDelta` typed in protocol v1 | Zero emitters — reserved stubs | `ui-core/protocol/events.ts:145-163` |
| Output guardrails | `checkOutput()` implemented + tested | Zero runtime callers — input path only | `guardrail-service.ts:91-95` |
| Kernel learning seams | recall/learn capabilities, Layer-injectable | Noop layers only; recall results computed then `void`ed | `iterate-pass.ts:442-443` |
| Live introspection | `state-inspector.ts` + `thought-tracer.ts` (observability pkg) | Not exposed through RunHandle | `observability/src/debugging/` |
| Replay UI | `ReplayControls.svelte` | Never imported anywhere | cortex ui |
| Orchestration durability | Event-sourcing, checkpoints, HITL step approval, resume | All in in-memory `Ref`s — crash loses everything; "durable" is a misnomer | `event-sourcing.ts:12` |
| Identity/RBAC | Full service incl. real Ed25519 (WebCrypto) | `authorize()` zero consumers outside own package | `identity-service.ts:39` |
| Honesty enforcement | Post-condition/artifact verification | `RA_POST_CONDITIONS` off by default | trace `analyze.ts:267` |
| Tool-call syscall boundary | gating concepts, riskLevel/requiresApproval metadata | `ToolService.execute` enforces nothing; JSDoc promises `ToolAuthorizationError` that isn't implemented | `tool-service.ts:319-409` |
| Calibration surfacing | Code-complete 3-tier resolution, LIVE by default | No CLI verb, no docs page, xfail example only — "the most under-surfaced shipped system" | `calibration-resolver.ts` |
| Vue binding | ui-core headless core | Vue hand-rolls its own duplicate; doesn't consume ui-core | `vue/src/use-agent-stream.ts:70-80` |
| Control plane | 7 compose chokepoints, 12 phases, `{skip}`/`inject` types | 4/7 chokepoints observe-only; 8/12 phase hooks never invoked; `{skip}` and `inject` dead; `registerKernel()` zero consumers | `harness-pipeline.ts`, `phase-hooks.ts:16` |

**Strategic conclusion:** the north star is executed as a **wiring program, not a building program**. What is half-built here exceeds what competitors have shipped whole. Every arc below is dominated by closing last miles with senior-level integration design — amplify, optimize, and maximize what exists. Corollary rule: **every dead seam either goes live or gets deleted** (no declarative debt survives this program).

## 2. What is genuinely alive (the load-bearing assets)

Verified-live systems the arcs build on — these are stronger than internal folklore assumed:

1. **Sense→decide control loop** — entropy composite (5 sensors, logprob-aware weights) → reactive controller (9 handlers) → dispatcher patches (strategy-switch, early-stop, temp-adjust, compression, tool-inject), firing per-iteration in production. `reactive-observer.ts:63-145`.
2. **3-tier calibration with community flywheel pull ON by default** — shipped prior → community profile (`api.reactiveagents.dev/v1/profiles`, 24h TTL cache, stale-safe failure) → local observations (override after 5 runs). Live aggregation: 309 samples on cogito:14b as of 2026-06-30.
3. **Telemetry default-on** — full RunReport (entropy traces, trajectory fingerprints, failure patterns, tool patterns), HMAC-signed, anonymous install-id, fire-and-forget, test-suppressed.
4. **Durable run rail** — 5-table SQLite RunStore, journaled SSE with seq cursors, cross-process attach, interaction + approval pause/resume rails. Best-in-class among TS frameworks.
5. **Gateway** — mature long-lived harness: adaptive heartbeat, cron, webhook ingestion, per-sender chat sessions in SQLite. `apps/advocate` runs on it 24/7 in production, streaming to Cortex ingest WS.
6. **Cortex studio** — pause/stop/resume/terminate/rerun REST verbs live; capability manifest auto-syncs new builder methods/strategies/config to the UI with zero per-field plumbing.
7. **Local learning engine** — bandit arm updates + skill synthesis + LLM skill distiller at run finalize; SKILL.md cross-vendor round-trip; learned-skill precedence over filesystem skills.
8. **Local-first reliability stack** — per-model calibration consumers (6+ fields active), 5-stage healing pipeline, capability-gated routing, tier-adaptive prompting. Public competitor bench receipt: RA best-of-6 on hard-execution tasks vs Mastra/LangGraph/Vercel on local models (cogito 44% after F1-F3 fixes).
9. **UI kit** (landed on main): versioned 21-tag wire protocol, resumable `connectRunStream`, pure `reduceRunState`, zero-token fixtures, React full binding + Svelte near-parity, 6 mount-anywhere endpoint helpers with owner-auth + wallet guards.
10. **Eval spine** — `packages/eval` (BYO suites, Rule-4 judge separation, SQLite history) + lift-gate/ledger discipline (internal), frozen judge-server container.

## 3. The OS metaphor, made literal

| OS layer | RA system | State | Program |
|---|---|---|---|
| Kernel | reasoning kernel, single-owner terminate | Strong, spine fixed | Keep canonical; expose seams honestly |
| Process model | durable runs, checkpoints, RunHandle | Substrate strong, unexposed | **Arc 1**: inspect/fork/attach |
| Event log (journald) | run_events + trace + EventBus + steps[] | Exists 4×, LLM I/O uncaptured | **Arc 1**: one canonical log |
| Trust rings | grounding, honesty taxonomy, verification pkg, guardrails, Ed25519 | 5 systems, disconnected | **Arc 1**: one trust spine → `result.receipt` |
| Syscall boundary | ToolService, policy, identity | Declared, unenforced | **Arc 2**: enforce at execute() |
| Quality gate | eval pkg + lift-gate + ledger | Split public/private | **Arc 2**: unified BYO gate |
| Process tree + IPC | sub-agents, orchestration, A2A, worker-pool | Fan-out only; A2A dormant; events isolated | **Arc 3**: the team |
| Drivers + JIT | calibration, healing, adapters | Alive; learning loop bolted at finalize, not woven | **Arc 4**: self-calibrating runtime |
| Package manager | compose harnesses, skills | Seams exist, no ecosystem | **Arc 4**: harness packages w/ receipts |
| The commons | api.reactiveagents.dev | LIVE, thin payloads | **Arc 4**: skills + aliases + provenance |
| Daemons | gateway, channels, proactive | Gateway mature; 1 channel adapter | Cross-cutting: adapters opportunistic |
| The console | Cortex + UI kit + rax | Rich but missing debugger views | Threaded through every arc |

---

## 4. Arc 1 — The Log + The Process ("agents became software")

**Theme:** the launch arc. Unify the record, expose the process model, return a trust receipt. The demo: *pause a live agent, inspect its state, revoke a tool, fork from iteration 12 with a different model, diff the timelines, ship the fix with a signed receipt — 90 seconds, all local, no SaaS.*

### 4.1 One event log (keystone)
- Every run — durable or not — appends to ONE canonical, versioned event log; trace JSONL, `run_events` journal, EventBus, and `steps[]` become projections/views of it. Resolves GH #188 (stream union diverged 3 ways) structurally.
- **Capture LLM I/O on the live path** (`LLMExchangeEmitted` currently never fires live — `trace/analyze.ts:322`). This single change makes full deterministic replay *recordable*, unlocking: zero-token CI, fork determinism, bisect, and Arc 4's self-improvement validator.
- Two-records doctrine (messages[] = LLM-visible, steps[] = systems-observed) is preserved — both become projections.

### 4.2 RunHandle v2 (the process model)
- `inspect()`: messages, tokens, iteration, entropy trajectory, pending tool calls. Wire the existing `state-inspector.ts`/`thought-tracer.ts` rather than building new.
- `fork({ at, model?, compose?, revoke? })`: branch a run from any checkpoint into counterfactual timelines; `diffRuns(a, b)` unified (today two divergent diff impls: `replay/diff.ts` vs `diagnose/diff.ts` — merge).
- Mid-run `grant()/revoke()` of tools at iteration boundary; model swap at iteration boundary (routing rail exists per-run; extend to boundary re-entry).
- Checkpoint durability fix: checkpoint writes are currently fire-and-forget (`Effect.runFork`, errors swallowed) — make awaited-with-timeout; add model identity to the resume config hash (today a swapped model resumes silently).
- CLI verbs: `rax ps` (live + durable runs, status, burn), `rax attach <run>` (cursor tail + control), `rax fork <run>@N`. Cortex: fork button, timeline scrubber, wire the orphan `ReplayControls.svelte`, cost analytics view.

### 4.3 `result.receipt` (one trust spine)
Five trust systems exist disconnected: `packages/verification` (semantic entropy + fact decomposition), guardrails (+dead `checkOutput`), trace honesty taxonomy (`honest-success | honest-failure | dishonest-success-suspected`), bench-only `trustVerdict`, grounded/* + off-by-default `RA_POST_CONDITIONS`. Consolidate into **one trust spine with one output**:
- Every `run()` returns `receipt`: verdict, claim→evidence provenance (which tool call grounded which claim), what is verified vs asserted, abstention record, config/model identity. Ed25519-signed (dormant crypto goes live).
- Emit the reserved `TrustEvent` protocol tag → UI kit renders trust natively (protocol already versioned for it).
- Close the audited grounding holes: no-`requiredTools` tasks get a grounding pathway; harness give-up terminals (`loop_detected`, `harness_deliverable`, etc.) receive a receipt-level "ungrounded delivery" mark rather than silent acceptance; `final_answer_tool` bypass documented or closed.
- Downstream contract: `if (!receipt.grounded) …` — trust becomes a type, not a dashboard.

**Arc 1 exit gate:** full-replay determinism test green (same log + same overrides → identical outcome, provider nondeterminism logged); fork-diff demo scripted end-to-end; receipt present on every `run()` including non-durable; the 90-second demo recorded.

## 5. Arc 2 — The Boundary + The Gate

**Theme:** control claims become load-bearing; the internal evidence discipline becomes a user-facing product.

### 5.1 Syscall boundary
- Enforcement moves INTO `ToolService.execute`: allowedTools, approval, per-tool budget/rate, riskLevel policy. The JSDoc-promised `ToolAuthorizationError` becomes real.
- Wire `IdentityService.authorize()` as the policy decision point; audit log on every tool grant/deny (AuditLogger exists). `packages/cost` budget-enforcer backs per-tool budgets.
- `.withPolicy({ tools: { "shell/*": { approval: true, budget: "$0.50" } } })` — one policy surface, enforced at the boundary, honored by Arc 1's `grant/revoke`.
- Default sandbox posture documented honestly (timeout-only vs docker opt-in); egress flags (`RA_AGENT_STRICT_EGRESS`, `RA_HTTP_ALLOW_PRIVATE`) promoted from env vars to policy fields.

### 5.2 Honesty default-on
- `RA_POST_CONDITIONS` (post-condition/artifact verification) and output-path guardrails (`checkOutput` — currently zero callers) go through the lift gate for default-on; custom-detector registration API added (today 3 hardcoded detectors).

### 5.3 The public gate
- Unify `packages/eval` (user-facing BYO) with the benchmarks lift-gate/ledger (private): one report shape, `rax eval gate` runs on user suites. The ≥3pp/≤15% discipline ships as a product feature.
- This gate is the validator Arc 4's self-improvement requires — build it before the loop, per the June-24 de-risking logic.

**Arc 2 exit gate:** policy enforcement test matrix green (deny/approve/budget-exceed at execute()); a user-authored suite runs `rax eval gate` outside the repo; honesty default-on decision recorded with ablation evidence.

## 6. Arc 3 — The Team (Extreme Ownership process tree)

**Theme:** multi-agent as an observable, accountable chain of command on the OS rails — MissionBrief down, UpwardReport up, receipts verified at every link. Ordered by wiring cost:

1. **A2A last mile** (small, high-value): bridge the agent executor into `createA2AHttpServer`, call `start()` in `agent.start()`, implement real SSE streaming. Protocol/cards/discovery/matcher are done and tested — this unlocks cross-machine mesh.
2. **IPC**: sub-agent events propagate to the parent EventBus, tagged by agentId/depth (today: fresh isolated bus per sub-agent). `rax ps` shows the process tree; Cortex renders live team topology.
3. **Orchestration durability**: move event-sourcing + checkpoints from in-memory `Ref`s onto the existing RunStore rail — durable workflows for free; crash-resume for teams.
4. **Chain of command**: `MissionBrief`/`UpwardReport` as typed framework primitives (UpwardReport superset of `SubAgentResult`); per-worker model/budget/tool-policy overrides enforced by Arc 2's boundary; parent verifies child receipts before consuming (trust chain); AAR via existing `synthesizeDebrief` feeds the ledger.
5. **Real orchestrator-workers**: implement the pattern (today falls through to sequential), wire the dormant worker-pool reliability tracking.
6. **Catalog breadth** (map-reduce/debate/pipeline variants) LAST, gated behind the M8 bench (GH #42) per falsification discipline — multi-agent only wins on decomposable tasks; prove it before headlining it.

**Arc 3 exit gate:** two RA agents on separate machines complete a delegated task end-to-end with receipt verification; a team run crash-resumes; Cortex team view live.

## 7. Arc 4 — The Flywheel + The Commons (the self-calibrating runtime)

**Theme:** every run makes the runtime better; every consenting install makes the platform better; behavior becomes a shareable, provable artifact. All quality claims behind the Arc 2 gate.

1. **Learned aliases close the loop**: healing successes write `knownToolAliases`/`knownParamAliases` back to the local calibration profile (the literal `act.ts:325` "Phase 2" TODO); widen local observations beyond the current 2 fields.
2. **Skill/capability substrate adapter**: populate `RunReport.skillFragment` (field exists on the wire type, never sent); validated skills with evolution telemetry (successRate, entropy-delta — schema already tracks) contributable to and pullable from the commons; capability probe results contributed with provenance.
3. **Commons provenance**: community profiles publish sampleCount/window/variance per field — profiles carry their own evidence (same honesty law as everything else).
4. **Auto-calibration fallback chain**: unknown model → local probe (runner exists, CLI-only, Ollama-only → runtime-invocable) → community profile → generic tier. No model starts blind if anyone has run it.
5. **Kernel learning woven in**: recall/learn Noop seams get real Layers backed by the LIVE ExperienceStore + learning engine (today bolted at finalize; weave into the loop, lift-gated).
6. **Surface calibration** (cheapest big win): `rax calibrate` verb, docs page, runnable example, template wiring — the most under-surfaced shipped system becomes a headline feature.
7. **Harness packages**: compose harnesses as publishable artifacts with a manifest; publishing a quality claim requires an attached, replayable gate receipt. The ecosystem inherits the evidence culture.
8. **Verifiable self-improvement** (the crown, only after 1–7): trace → diagnose → propose harness mutation → replay-validate on held-out logs (Arc 1) → adopt only on gate pass (Arc 2) → ledger entry. The agent gets a changelog of itself, every entry evidenced.

**Arc 4 exit gate:** an unknown Ollama model auto-calibrates and improves across 10 runs (measured); a skill contributed from one install improves a fresh install's run (measured, consented); one harness package published with a receipt.

## 8. Cross-cutting duties (threaded through arcs, not separate)

- **Vue onto ui-core** (parity debt — hand-rolled duplicate today); Svelte components backfill.
- **genUI streaming**: emit `UiTreeDelta` (+`ObjectDelta`/`StepEvent`) — reserved tags get emitters; `reconcileUiTree` goes live.
- **AG-UI adapter**: thin interop skin over the versioned bespoke protocol (own the semantics, plug into their frontends). Do not compete on bindings.
- **Templates light up the studio**: create-reactive-agent wires telemetry/Cortex by default (today: none do); add durable/gateway/a2a templates; fix stale template help text.
- **Channels adapters** (discord/telegram real transports — today webhook only) opportunistic, demand-driven.
- **Interaction package surfaced**: 5 autonomy modes (autonomous→interrogative) exposed through process-model UX and docs (mature code, 3 consumers).
- **Docs debt**: calibration page (none exists), ui-kit reference, CLI reference refresh.
- **Dead-seam law**: every audit-flagged dead seam (8 phase hooks, `{skip}`, `inject`, `registerKernel`, unused ControllerDecision variants, `ReplayControls`, `demo-responses`, …) is either wired by its arc or deleted. Zero declarative debt at v1.0.

## 9. Non-goals (carried, do not resurface)

- New reasoning strategies (heavy-strategy parity falsified — memory 2026-06-05).
- Falsified levers: cache-churn, extractObservationFacts, local-step-economy, rationale-splitting, escalation-lift, dual-compression (blacklist per `01-RESEARCH-DISCIPLINE`).
- UI-binding feature race vs TanStack/CopilotKit (commoditized layer).
- Memory-as-a-product (green problem, red market — build staleness/identity in, don't build a company around it).
- Learned/self-evolving topologies; tool synthesis (revisit only after Arc 2 sandbox/boundary).
- Any default-on flip without the lift gate (≥2 tiers, ≥3pp, ≤15% tokens).

## 10. Sequencing, dependencies, and posture

```
Arc 1 (Log+Process+Receipt)  ──►  launch line (Show-HN with bench receipts + 90s demo)
   │  log ► fork/CI/bisect;  receipt ◄ trust spine
Arc 2 (Boundary+Gate)  — parallelizable with Arc 1 back half
   │  gate ► Arc 4 validator;  boundary ► Arc 3 per-worker policy
Arc 3 (Team)  — needs Arc 1 log (observability) + receipts (trust chain)
Arc 4 (Flywheel)  — needs Arc 2 gate (validation) ; A2A/commons independent starts OK
```

- Milestone naming/versioning intentionally deferred to the roadmap amendment (this spec is direction; ROADMAP.md carries dates/versions).
- The unfired launch line (public competitor bench + Show-HN) executes at the Arc 1 boundary — receipts exist today; Arc 1 gives them their product frame.
- Research discipline Rules 1–12, single-owner terminate invariant, tag-driven lockstep release flow: unchanged and binding.

## 11. What this means for developers (the paradigm shift)

| Today (all frameworks) | After this program |
|---|---|
| Prompt-and-pray, console.log | Attach, inspect, step — debug agents like processes |
| Run failed? Re-run, shrug | Fork at the divergence, bisect the cause, diff timelines |
| "Trust me" outputs | Signed receipts, claim-level provenance, `if (!receipt.grounded)` |
| Works on GPT-4, dies on your model | Runtime probes, learns, and shares drivers for any model |
| "Self-improving" = marketing | Self-changelog with replay-validated, gate-passed diffs |
| Middleware = vibes | Harness packages that must carry receipts to make claims |
| Agent tests cost tokens | Zero-token CI against recorded reality |
| Multi-agent = fan-out hope | Chain of command with mission briefs, upward reports, verified receipts |

**README one-liner target:** *Agents became software engineering.*

---

*This spec is amendable in detail, immovable in spirit. `00-VISION.md` remains the constitution; this is the program that finishes it. Every dead seam goes live or dies. Every claim carries a receipt.*

*Created 2026-07-05. Author: framework review session (10-subsystem audit + landscape research). Ratified direction by tylerjrbuell.*
