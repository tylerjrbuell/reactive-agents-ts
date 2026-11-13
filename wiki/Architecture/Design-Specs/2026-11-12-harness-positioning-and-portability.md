---
type: design-spec
status: draft
created: 2026-11-12
tags: [positioning, harness, portability, mcp, a2a, ag-ui, docs-ia, amendment-proposal]
---

# Harness positioning and portability: exploration + recommendation

> **Not a north star.** AGENTS.md forbids a fourth one. This is an exploration that proposes
> amendments to [[../Specs/09-UNIFIED-PROGRAM]] and [[../Specs/08-AGENTIC-OS-NORTH-STAR]] for the
> owner to ratify (section 6 has the exact text). Nothing here is applied. No code was edited.
> Evidence method: `bun run repo find/scope`, direct reads, `node` over `package.json`, and web
> reads dated 2026-11-12. Unknowns are marked **[UNKNOWN]**.

## 0. Summary

1. **Call it an agent harness; keep the name.** "Harness" is already the landing-page word
   (`apps/docs/src/content/docs/index.mdx` hero) and the field now uses it for the layer around the
   model (section 2). Do not rename packages. Adopt "Agentic Harness SDK" only as a sub-label after
   the embed/host path in section 3 ships, because "SDK" promises embeddability we do not yet document.
2. **Most of the swappable-harness substrate exists but is unpackaged.** A journaled SSE run endpoint, a
   resumable attach endpoint, approval/interaction endpoints, an additive-only versioned wire protocol
   (`PROTOCOL_VERSION = 1`) and an A2A server are all in the tree. What is missing is the
   *host-facing contract*: an MCP server, an OpenAI-compatible endpoint, an AG-UI skin, a published
   `AgentConfig` JSON Schema, and a conformance suite. None of those four adapters exists (verified, 3.1).
3. **First slice:** `agent.serveMCP()` (mirror of the existing `serveA2A()`), exposing the agent as MCP
   tools. One adapter makes the harness callable from every MCP-capable host. Gate it behind a cheap
   demand spike first (feedback_spike_before_build).
4. **Biggest honesty risk:** 08's section 1 table is a 2026-07-05 snapshot and is partly stale (A2A is
   now served; see 1.4). Positioning claims must be re-verified against code, not 08.

## 1. What is actually offered

Counts (verified 2026-11-12): `ls packages` = 35 dirs; `package.json` scan = **33 public + 2 private**
(`benchmarks`, `judge-server`). `ls apps` = 6 dirs (advocate, cli, cortex, docs, examples,
stackblitz). `apps/docs/src/data/metrics.json`: 8 providers, 8 strategies, 12 phases, 2,104 test files,
13,601 tests (**cached CI figure**, `testsCached: true`; I did not run the suite). Version `0.18.0`.

Stability column uses `reference/stability.md`. **That page is stale**: its title and headings say v0.12,
the repo is 0.18.0, and it lists `rax serve`-era surfaces only loosely. Tier below = what the page says;
"not listed" = the page does not mention it.

### 1.1 Harness core (inside the run)

| Capability | Where | Stability (per page) |
|---|---|---|
| Composable kernel + 8 strategies, single-owner terminate | `packages/reasoning/src/kernel/`, `strategies/` | Stable: reactive, reflexion, plan-execute-reflect, tree-of-thought, adaptive. `code-action` experimental |
| 12-phase engine, builder, `createAgent(config)` | `packages/runtime` (`builder.ts`, `create-agent.ts`) | Stable |
| Tools, healing pipeline, built-ins, MCP **client** | `packages/tools` (`src/mcp/mcp-client.ts`) | Stable (tool surface); healing stages unstable; MCP registry experimental |
| Memory (4 layers, SQLite/FTS5/vec) | `packages/memory` | Not listed. Opt-in (AGENTS/MEMORY) |
| Context curation | `packages/reasoning/src/assembly/project.ts` | Profile stable; curator internals unstable |
| Guardrails, kill-switches, identity | `packages/guardrails`, `packages/identity` | Not listed. Security audit 2026-11-12 left open items (approval default, channels fail-open, exporter redaction) |
| Verification, trust receipt | `packages/verification`, `TrustReceipt` in core | `.withGrounding` unstable; receipt not listed |
| Cost tracking and routing | `packages/cost` | Tracking stable; routing policy unstable |
| Judgment (Jev/LLM/Ollama backends) | `packages/judgment` | Not listed |
| Reactive intelligence (entropy, controller) | `packages/reactive-intelligence` | Tunables experimental |
| Providers (8) | `packages/llm-provider` | Stable |

### 1.2 Control surfaces

- Builder `.withX()` and declarative `createAgent(config)` are "the same API in two syntaxes",
  generated from `AgentConfigSchema` (`packages/runtime/src/agent-config.ts:743`). Stable.
- Compose (`packages/compose`, 221 non-test LOC): `.compose()`/`.withHarness()`, tag-pattern transforms,
  6 killswitches (`./killswitches`). Stable.
- Lifecycle hooks for 12 phases. Stable. `KernelHooks` unstable.
- Profiles `lean/balanced/intelligent`. Stable.

### 1.3 Observability and diagnosis loop

| Piece | Evidence | Notes |
|---|---|---|
| Trace + attribution | `packages/trace` (7,060 LOC; `attribution-*.ts`, `taxonomy.ts`) | Not listed in stability.md |
| Replay | `packages/replay` (737 LOC): `loadRecordedRun`, `replay`, `diffTraces` | Stable. Counterfactual restart, not time travel (08 4.2 note) |
| Diagnose | `packages/diagnose` (1,799 LOC), bin `rax-diagnose` | Not listed |
| OpenInference/OTLP export | `packages/observe` (440 LOC): `OpenInferenceTracerLayer`, `setupOpenInferenceExporter`, Langfuse | Not listed |
| Eval + lift gate | `packages/eval`, `rax eval-gate`, `packages/testing/src/gate` | Not listed |
| ObservabilityService, ThoughtTracer, EventBus | `packages/observability`, `packages/core` | Event tags stable |

### 1.4 Runtimes and surfaces

| Surface | Evidence | State |
|---|---|---|
| Gateway (cron, heartbeat, webhooks, policy) | `packages/gateway` | Mature per 08 s2. I did not re-audit it |
| Channels | `packages/channels` (5,405 LOC): adapters = signal, telegram, webhook; `routing/` router | Router is a 2026-11-12 proposal in flight |
| A2A | `packages/a2a` (1,374 LOC): `agent-card`, `server/http-server.ts`, `client/` | **Experimental.** `agent.serveA2A()` at `packages/runtime/src/reactive-agent.ts:802` binds a port. 08's "executor never bridged" row is stale. Docs still say SSE streaming is not implemented |
| MCP **client** | `packages/tools/src/mcp/` (`mcp-client.ts`, `registry/`, `auth/`) | Stable-ish (see 1.1) |
| MCP **server** | none in packages. `StdioServerTransport` appears only in `docker/signal-mcp` and a Cortex test fixture | **Not offered.** 08/W7 still open, confirmed |
| HTTP endpoints | `packages/runtime/src/server/endpoints.ts`: `createAgentEndpoint`, `createRunAttachEndpoint`, `createInteractionEndpoint`, `createApprovalEndpoint`, `createInboxEndpoint` (Web `Request`->`Response`, mount in Bun/Hono/Next) | Exported from runtime `index.ts:178-186`. Not in stability.md |
| UI protocol + bindings | `packages/ui-core` (7,512 LOC), `react`, `svelte`, `vue`. `PROTOCOL_VERSION = 1`, "additive-only after v1: never remove or repurpose a _tag" (`ui-core/src/protocol/events.ts:1-9`) | Not in stability.md. 08 says Vue hand-rolls its own duplicate; **[UNKNOWN]** if fixed |
| CLI | `rax` and `reactive-agents` bins (both facade and `apps/cli`); commands include run, serve, deploy, attach, ps, eval, trace, mcp, skills, cortex | `rax serve` = A2A server only (`apps/cli/src/commands/serve.ts`, "Start an agent as an A2A server") |
| Deploy | `apps/cli/src/commands/deploy/`: local, fly, railway, render, cloudrun, digitalocean; `--mode daemon\|sdk`; `rax init --template cloudflare-worker` | `sdk` mode generates a `Bun.serve` wrapper with `POST /chat`, `POST /chat/stream`, `/health`, `/ready`, `/.well-known/agent.json` (`apps/cli/src/templates/sdk-server.ts`). Bespoke shape, not a standard protocol |
| Cortex | `apps/cortex` (Bun/Elysia + SvelteKit): chat, runs, Lab builder, judgments, approvals | Public npm `@reactive-agents/cortex`; no auth by default per `cli.md` |

### 1.5 Not offered (honest-claims law, 08 s4.2 / 09 s2)

Verified absent by `repo find` or directory listing unless noted:

- No MCP server; no OpenAI-compatible `/v1/chat/completions` server (matches appear only as *client* calls
  in `llm-provider`); no AG-UI adapter (`find AG-UI --code`: no results; 08 s8 listed it as a duty);
  no Agent-Protocol-style endpoint (only a `package.json` keyword in a2a).
- No published `AgentConfig` JSON Schema file. A schema *is* generated internally
  (`runtime/src/capability/config-fields.ts:95`, `JSONSchema.make(AgentConfigSchema)`) for Cortex, but I
  found no artifact shipped to consumers.
- No conformance suite for third-party hosts or implementations. `packages/testing` has gate scenarios,
  doubles and a trace-expect harness, all internal.
- No claim of determinism, correctness-certifying receipts, or measured gains beyond the ledger
  (08 s4.2, s4.3 binding notes). Default-on mechanisms are lift-gated; "eight lift attempts, zero passes"
  (09 s8) is the standing evidence base.
- Known drift to fix before any new claim: `packages/reactive-agents/README.md` says "Five reasoning
  strategies. Six LLM providers" while metrics say 8 and 8; `stability.md` is v0.12-era; the landing page
  says "13 capability layers" with no verified source here.

## 2. Framing

### 2.1 How the field uses the words (read 2026-11-12; secondary sources flagged)

| Vendor | Their own framing | Source |
|---|---|---|
| LangChain | Three layers: LangChain = framework (building blocks), LangGraph = runtime, **Deep Agents = "the agent harness"** with planning, filesystem, subagents, memory. Docs point to a "Frameworks, runtimes, and harnesses" page | https://docs.langchain.com/oss/javascript/deepagents/harness (fetched 2026-11-12) |
| Anthropic | Agent SDK = Claude Code's tools, loop and context management as a library; Managed Agents = "a hosted agent harness". Engineering post on harnesses for long-running agents dated 2025-11-26 | https://code.claude.com/docs/en/agent-sdk/overview (fetched 2026-11-12); https://anthropic.com/engineering/effective-harnesses-for-long-running-agents (via search snippet only, not fully read) |
| OpenAI | Codex harness = open-source loop behind Codex; exposed via **app-server** (documented client protocol: threads, turns, events, interrupt, tools, approvals), Codex SDK, `codex exec`. Agents SDK TS gained the harness and sandbox agents (reported v0.9.1, 2026-05-06, secondary source) | https://developers.openai.com/blog/codex-as-a-platform (fetched; page undated); secondary: https://codex.danielvaughan.com/2026/05/06/agents-sdk-typescript-sandbox-agents-codex-harness-portable-compute/ |
| Pydantic | Pydantic AI = core framework; **Harness SDK** adds memory, guardrails, sub-agents, planning as capabilities; stack = Evals, Graph, Logfire | https://pydantic.dev/docs/ai/comparisons/vs-mastra/ (fetched) |
| Vercel AI SDK | v6 agent abstractions; secondary source says a `HarnessAgent` runs an existing harness (Claude Code, Codex) and streams into AI SDK UI | https://dev.to/alexcloudstar/ai-agent-frameworks-in-2026-langgraph-vs-mastra-vs-vercel-ai-sdk-vs-openai-agents-sdk-vs-pydantic-539b (secondary; **[UNKNOWN]** vs Vercel docs) |
| Mastra | Described as a TypeScript agent framework (workflows, memory, evals, Studio). I found no primary page calling it a harness | same secondary roundup; not verified at mastra.ai |
| Letta | No source placing it in the harness/framework taxonomy found | **[UNKNOWN]** |

Reading: "harness" is converging on *the agent loop + tools + context + permissions around a model*,
with three recurring traits: it is **open and inspectable** (Codex), **embeddable via a protocol or SDK**
(app-server, Agent SDK), and **opinionated but replaceable** (Deep Agents). Sources disagree on exact
boundaries; one commentator argues the broad wording collides with the definition of "agent". The term
is still settling.

### 2.2 What each term promises

| Term | Promise to a developer | Fit for RA today |
|---|---|---|
| Framework | Building blocks I assemble; I own the app | True (builder, Effect layers). Strongest search term. Undersells the run-time machinery (healing, termination, receipts) |
| Harness | A governed loop around the model that I can inspect and steer | True and already used on the landing page. Matches the "reliable on any model tier" story |
| Agentic Harness SDK | A harness I embed in my product through a stable library or protocol | **Half true.** Library: yes. Stable host protocol and adapters: no (section 3) |
| Agent runtime | A thing that hosts and schedules agents | True for gateway/durable runs; collides with LangGraph's "runtime" and with 09's "OS" language |

### 2.3 Where RA genuinely differs (each tied to code, not marketing)

1. **Control with a typed seam at every phase**: 12 phases x before/after/on-error hooks, compose with
   tag matching, six killswitches.
2. **Observe, replay, diagnose as one loop**: `trace` -> `replay` -> `diagnose attribute` -> eval lift
   gate -> ledger. No competitor read in 2.1 ships the diagnose-from-trace step; **[UNKNOWN]** for
   Pydantic Logfire and LangSmith internals, so phrase as "in the box and local-first", not "only".
3. **Deterministic over LLM-driven** (AGENTS golden rule 5): healing, termination arbitration, grounding
   checks are computed.
4. **Local and cloud tiers**: calibration, tier-adaptive prompting, the "same code on a 4B model and a
   frontier API" claim. Evidence: bench receipts in `wiki/Research/` (not re-run here); 08 s2 item 8.
5. **Typed Effect composition** across 33 public packages with explicit Layers.

Weak differentiators to avoid leading with: UI bindings (commoditized, 08 s0), durable execution (table
stakes, 08 s0), multi-agent (08 s6 gates the catalogue behind a bench).

### 2.4 Recommendation

**One-line positioning (proposed):**
> Reactive Agents is the TypeScript agent harness you can inspect, replay and steer: one typed loop that
> runs the same code on a local 4B model or a frontier API, and returns evidence with every run.

**Tagline set (pick one for the hero, keep others for README, social, docs `<title>`):**
- "Agents you can audit." (shortest; ties to receipts + replay)
- "The harness you can see inside." (control/transparency; plays on "black-box harness" copy already on the landing page)
- "Reliable on any model. Visible on every run." (tier + observability)
- "Replay it. Diagnose it. Ship it." (loop; developer tone)

**Docs information architecture (details in section 6.3):** hero -> "Why a harness" (new concept page) ->
one real run (existing RunReplay) -> receipt -> control surfaces -> **"Use it inside your platform"** (new
hub, section 3) -> comparison pages -> reference. Keep "framework" in meta descriptions and the
`build-ai-agents-typescript` guide for search, since developers still search "agent framework".

**Claims we may make now:** typed events at every phase; replay of recorded runs with tool results held
constant (exact-replay regression, not determinism); healing pipeline repairs malformed tool calls
deterministically; `TrustReceipt` is graded evidence with provenance and an optional Ed25519 signature
(integrity, not correctness; 08 s4.3); 8 providers incl. local Ollama; MCP *client*; A2A server (label
experimental); OpenInference export.

**Claims we may not make:** "drop-in" or "works with LangGraph/Vercel/Claude Agent SDK" (no adapter or
conformance exists); "MCP server", "OpenAI-compatible", "AG-UI" support; "swappable harness" as a
shipped feature; "Harness SDK" in titles before Phase 1 lands; "deterministic" or "time-travel" replay;
"signed = true"; "self-improving" beyond the ledger discipline; any strategy or mechanism lift not in the
ledger; "most complete"/"only" comparisons (unverified competitors).

**Naming consequences and migration cost:**

| Item | Change | Cost |
|---|---|---|
| npm scope `@reactive-agents/*` (33 public pkgs), facade `reactive-agents` | None. Renaming breaks lockstep release stamping, every import, the community-profile API, and SEO | Proposed: do not do. Cost if forced: L, high risk |
| CLI `rax`, `rax-diagnose`, `reactive-agents` bin | None | - |
| New `@reactive-agents/harness` facade | Reject: a fourth facade beside `reactive-agents` and `runtime`; AGENTS forbids new roles/packages without evidence | - |
| Docs titles, hero, README, meta descriptions | Reword (section 6.3) | S, one docs PR + `check-docs-sync` |
| Comparison pages (`reactive-agents-vs-*`) | Add a "harness vs framework vs runtime" row; they already say "vendor-neutral agent harness" (`reactive-agents-vs-agent-sdks.mdx`) | S |
| "Agentic OS" language in 08/09 | Keep as internal program name; external one-liner uses "harness" (an OS contains a harness) | S, wiki only |

**Strongest counter-argument.** "Harness" is a fashion word with no agreed definition (2.1: sources
disagree) and its loudest users (Codex, Claude Code, Deep Agents) are *coding-agent* harnesses. Leading
with it may (a) pigeonhole a general framework with gateway, channels, memory, cost and Cortex as a coding
tool, (b) lose searchers who type "agent framework", and (c) invite a direct comparison to Codex and
Claude Code on their home turf, which RA does not win. A framework label is safer and truthful.
**Response:** the landing page already ships the "transparent harness" story, the differentiators in 2.3
are all harness-layer, and `framework` stays in SEO surfaces. Revisit if the Phase 0 docs change shows
worse activation (**[UNKNOWN]**: no baseline; the docs use Umami, check `apps/docs/public/umami-deep.js`
config before the change to get one).

## 3. Making the harness swappable inside other platforms

### 3.1 Audit of what exists

| Need from a host | What exists | Gap |
|---|---|---|
| Embed in-process | `createAgent(config)`, `ReactiveAgents.create()`, `agent.run`, `agent.runStream`, `AgentResult` (stable). Runtime exports raw provider Layers so the harness can be skipped | Runs on Bun or Node 22.5+ (runtime-shim); `reasoning` exports `dist` so source edits need a build (AGENTS rule 8) |
| Call over HTTP with streaming and resume | `createAgentEndpoint` (POST `{prompt}` -> journaled SSE, seq-stamped when durable runs are on), `createRunAttachEndpoint` (cursor replay + live tail), interaction/approval/inbox endpoints, per-identity guards | Wire shape is "`WireEvent`" JSON from `ui-core`; not documented as a host contract; not in stability.md; resume only with `.withDurableRuns()` |
| Agent as a tool for other agents/hosts | A2A server `agent.serveA2A()` + card at `/.well-known/agent.json`, A2A client, `rax discover` | Experimental; no streaming; `rax serve` is A2A-only. **No MCP server** |
| Chat-completions consumers | none | **No OpenAI-compatible server** |
| Agent UI protocols | Own protocol v1 + React/Svelte/Vue bindings, `connectRunStream` (resumable) | **No AG-UI skin** (08 s8 sanctioned it; `find` shows no code) |
| Portable agent definition | `AgentConfigSchema` (Effect Schema), `createAgent(config)` validates with `Schema.decodeUnknownSync` | No published JSON Schema; **[UNKNOWN]** how much of a config is JSON-serializable (custom tools, hooks, `defineTool` closures are code, not data) |
| Behavior composition by hosts | compose + killswitches, lifecycle hooks, `withHook` | Fine |
| Telemetry into host stack | OpenInference/OTLP + Langfuse preset (`packages/observe`) | Not listed in stability tiers |
| Deploy | 6 targets + `--mode sdk` HTTP wrapper | `sdk` wrapper has its own bespoke `/chat` shape; two HTTP shapes now exist (wrapper vs endpoints) |
| Local studio | Cortex | Not a host protocol |
| Third-party implement-the-contract | none | **No conformance suite** |

Note on duplication: `sdk-server.ts` (`/chat`) and `server/endpoints.ts` (journaled SSE) are two
unrelated HTTP surfaces for the same job. Per feedback_canonical_reuse, unify before adding a third.

### 3.2 The closest industry analogue

OpenAI's Codex **app-server** is the model to study: a documented protocol with threads, turns, events,
interrupt, tool exposure and approval requests, so a product can host the harness while owning UX.
RA already has each ingredient (runs + journal cursor, `RunAttached`, interruption via cancel, approval
and interaction endpoints, tool events, `TrustReceipt`). What RA lacks is the *named, versioned,
documented contract* and a second implementation proving it is a contract.

### 3.3 Gap list

Effort S <= 3 days, M ~ 1-2 weeks, L > 2 weeks, including tests and docs. Owners per `bun run repo scope`
and AGENTS ownership; `apps/cli` has **no owner** (scope output), so CLI changes need an owner decision.

| # | Item | Effort | Owner warden | Depends on | Adoption unlock |
|---|---|---|---|---|---|
| G1 | **MCP server**: `agent.serveMCP({transport})` exposing `run_agent`, `get_receipt`, optionally per-tool passthrough. Impl in `packages/tools/src/mcp/server`, method on `ReactiveAgent` | M | tools-warden (impl), runtime-warden (method) | MCP SDK already a dep via client; none else | **Highest.** Claude Code/Desktop, Cursor, LangGraph and Vercel AI SDK MCP clients, OpenAI Agents SDK MCP support all consume it |
| G2 | OpenAI-compatible `/v1/chat/completions` (+ `/v1/models`) as an endpoint factory in `runtime/src/server/` | S-M | runtime-warden | G0 event mapping | High for anything with a base-URL field (Open WebUI, LibreChat, editors). Lossy: tool/receipt metadata does not fit. Streaming via `text_delta` mapping |
| G3 | Publish `AgentConfig` JSON Schema (`rax config schema`, file in package + docs URL), versioned with the package | S | runtime-warden (+ owner for `apps/cli`) | `config-fields.ts` already builds it | Medium: validation in IDEs, Cortex-like builders, "agent as JSON" in other platforms. Must state which fields are code-only |
| G4 | **Name the Run Protocol**: document `ui-core` events + `runtime` endpoints as the host contract; promote to a stability tier; add `docs reference/run-protocol.md` | S (docs) | core-warden (contract), runtime-warden | none | Medium alone; prerequisite for G2, G5, G7 |
| G5 | AG-UI adapter: thin mapping `UiEvent` -> AG-UI events at an endpoint factory | M | runtime-warden, core-warden review | G4; **[UNKNOWN]** AG-UI spec version to pin (not researched here) | Medium: CopilotKit and AG-UI frontends. 08 s8 already sanctioned it |
| G6 | A2A streaming + executor cancel (docs say SSE absent; cancel only flips status) | M | gateway-warden | none | Medium: A2A hosts (Google ecosystem). Spec churn risk (stability.md) |
| G7 | **Conformance suite**: `@reactive-agents/testing` exports scenario fixtures + a protocol checker any implementation or host can run (events order, cursor resume, receipt shape, approval pause/resume) | L | core-warden + harness-warden (instrument) | G4 | Low immediate, high long-term: turns "swappable" from claim into test |
| G8 | Recipes, not packages: Vercel AI SDK `tool()` wrapping `agent.run`; LangGraph node calling `serveMCP`/endpoint; Claude Agent SDK via MCP | S each (docs) | runtime-warden / update-docs | G1 for two of three | Medium; cheapest proof of "drop in" |
| G9 | Unify `rax serve` / deploy `--mode sdk` / `createAgentEndpoint` onto one handler set; `rax serve --mcp --openai --a2a` flags | M | **unowned** (`apps/cli`) + gateway-warden (deploy) | G1, G2 | Removes the two-shapes problem; enables one-command hosting |
| G10 | Make `AgentResult` + `TrustReceipt` JSON-schema'd wire types in `core` | S-M | core-warden | none | Supports G2-G7 |
| G11 | Auth story for hosted endpoints (bearer, `identify` hook exists in guards); Cortex has none by default | S (docs) to M | runtime-warden, cortex-warden | none | Gate for any "hosting inside a platform" claim; security audit 2026-11-12 left items open |

### 3.4 Which unlocks the most adoption

G1 (MCP server) by a wide margin: it is the common denominator tool interface of every host named in
2.1, one implementation covers them, and it also gives Claude/Codex-style agents RA's differentiators
(receipt, replay id) as tool outputs. G2 second (long tail of UIs). G3+G4 are cheap and unblock the rest.
G7 is the only item that makes "swappable" a *verifiable* property; schedule it, do not skip it.

Demand evidence: **[UNKNOWN]**. I found no trace or issue count showing hosts asking for any of these
(I did not search GitHub issues). Run the zero-token spike first: grep issues/Discord for "mcp server",
"openai compatible", "langgraph", "vercel" before G1 (feedback_spike_before_build).

### 3.5 Boundaries that must stay stable for third-party hosts

| Boundary | Today | Rule to ratify |
|---|---|---|
| `ui-core` wire protocol (`PROTOCOL_VERSION`, `_tag`s) | Additive-only after v1 (events.ts header). Not in stability.md | Declare **stable**; breaking change = protocol v2 with a dual-emit window |
| `@reactive-agents/core` contracts: `AgentEvent`, ids, `TrustReceipt`, `AgentResult` | `AgentResult` and event tags listed stable | Keep additive, modality-neutral (09 s2): no new type may assume string turns |
| `AgentConfigSchema` | Stable at the entry-point level, fields grow | Additive fields only; deprecation cycle for removals; publish schema version |
| `runtime/src/server/endpoints.ts` signatures and SSE framing | Not tiered | Tier as unstable now, stable after G4 + G7 |
| Replay/trace file format (`packages/trace`, `replay`) | `replay` stable; `trace` not tiered | Version the trace schema; hosts export and diagnose offline |
| A2A surface | Experimental | Stay experimental until spec settles; do not promise |
| `reasoning` internals, kernel hooks | `KernelHooks` unstable | Never part of the host contract |

## 4. Roadmap

| Phase | Content | Exit evidence | Notes |
|---|---|---|---|
| P0 docs + claims (S, ~1 week) | Section 6.3 docs change; G4 doc; G3 schema; stability.md refresh; fix README/landing count drift | `check-docs-sync` green; metrics page consistent; baseline analytics captured first | No code risk. Do this first; positioning without it is promises |
| P1 first slice (M) | **G1 `serveMCP()`** + G8 recipes (MCP-based) | Scripted test: an MCP client lists tools, runs a task, receives output + receipt id; recipe verified live from Claude Code or another MCP host; doc page "Use Reactive Agents inside X" | Demand spike precedes build. Follow the `serveA2A()` pattern (method on `ReactiveAgent`, default port from builder carrier) |
| P2 breadth (M) | G2 OpenAI-compat, G9 unify serve/deploy handlers, G10 wire types | Open WebUI (or similar) chats with an agent; one handler set serves A2A + MCP + HTTP | Decide `apps/cli` owner first |
| P3 ecosystem (M-L) | G5 AG-UI, G6 A2A streaming | CopilotKit sample works; two RA agents stream across machines (08 Arc 3 gate) | Pin spec versions; **[UNKNOWN]** AG-UI maturity |
| P4 verifiable contract (L) | G7 conformance suite; promote Run Protocol to stable; "Harness SDK" label allowed | Suite runs in CI against RA and against one independent minimal implementation | Only then use the phrase "swappable" |

Not lift-gated: protocol adapters are not harness mechanisms (09 s2 lift rule covers default-on
mechanisms). They are gated by honest-claims law and by the conformance suite. Any adapter that changes
default behavior goes to ablation-warden.

**Concrete first slice (P1) acceptance, drafted:**
1. `agent.serveMCP({ transport: "stdio" | { http: { port } }, expose: ["run_agent","get_receipt"] })`.
2. `run_agent` input = `{ task: string, runId?: string }`; output = text + structured `{ receipt, runId, status }`; cancel maps to existing `agent.cancel(taskId)`.
3. Respects existing guardrails/approval: a tool needing approval returns a typed "awaiting-approval" result with the run id and the approval endpoint, rather than blocking the MCP call forever.
4. Test: spawn server, connect with the MCP SDK client, run against the `test` provider, assert zero tokens; second test asserts a refused call under policy.
5. Docs: `guides/use-in-other-platforms.mdx` tab for MCP hosts; changeset; stability tier experimental.

## 5. Risks and unknowns

- **Surface sprawl vs 09's WIP=1 posture and "the harness is mis-wired, not rigid" finding.** Adapters
  add maintenance. Mitigation: they are thin mappings over one Run Protocol; no adapter without a
  conformance test; defer G5/G6 on weak demand.
- **Security.** An MCP/OpenAI endpoint exposes a tool-using agent to a network. Open audit items (approval
  default, channels fail-open, exporter redaction) bind first. `shell-execute` stays opt-in; hosted
  endpoints default to bearer auth and no builtins beyond what the config sets.
- **Honesty of "drop-in".** Hosts differ on streaming, tool schemas and cancellation. Publish per-host
  recipes with a "verified on <version, date>" line instead of a generic claim.
- **[UNKNOWN]** items: demand; AG-UI version; JSON-serializable subset of `AgentConfig`; Vue/ui-core
  parity; whether gateway/guardrail rows in 08 s1 still hold (that table is dated 2026-07-05); Vercel,
  Mastra and Letta positioning from primary sources.
- Competitive web reads are partly secondary and date-sensitive; re-verify before external publication.

## 6. Proposed amendments (not applied)

### 6.1 Amend `09-UNIFIED-PROGRAM.md`

```diff
 ## 1. The one goal
 ...
 K makes agents capable. P makes them governable. T keeps both honest.
+
+**External name (NEW, proposed).** The product is described externally as a *TypeScript agent
+harness*: the typed, observable, replayable loop around the model. "Agentic OS" remains the
+internal program name for the arcs; the harness is the kernel the OS contains. Package names, CLI
+names and the npm scope do not change. "Harness SDK" may be used in titles only after P4 below.
```
```diff
 ## 2. Program invariants (law — unchanged)
+- **Host-contract stability (NEW, proposed).** The `ui-core` wire protocol, `AgentResult`,
+  `TrustReceipt`, `AgentEvent` tags and `AgentConfigSchema` are the third-party host contract.
+  Additive-only within a major protocol version; removals follow the stability.md deprecation
+  cycle with a dual-emit window. A host adapter without a conformance test may not be described
+  as "supported".
```
```diff
 ## 7. The ordered path
+**H-series: host portability (NEW, proposed; runs beside, not ahead of, Strand K).**
+H0 docs + claims + schema (S) -> H1 `serveMCP()` (M, after a demand spike) -> H2 OpenAI-compat +
+one handler set for serve/deploy (M) -> H3 AG-UI + A2A streaming (M) -> H4 conformance suite and
+stable Run Protocol (L). Each step ships with its own abort gate: no demand evidence at H1 means
+H2-H3 stay unscheduled.
```
```diff
 ## 8. What is NOT the path
+- **Renaming packages or the npm scope to match a category word.** Cost is L and breaks lockstep
+  release stamping; the label belongs in docs.
+- **A feature race on host adapters** (AG-UI, OpenAI-compat) beyond a thin mapping over the Run
+  Protocol. We own the protocol semantics; we do not chase every frontend (08 s9 carried).
+- **Hosting third-party harnesses inside RA** (the Vercel `HarnessAgent` direction). Out of scope.
```

### 6.2 Amend `08-AGENTIC-OS-NORTH-STAR.md`

```diff
 ## 1. The master finding ...
+> **Snapshot note (proposed).** The table is dated 2026-07-05. Row "A2A mesh": `serveA2A()` now binds a
+> port (`reactive-agent.ts:802`); only SSE streaming and executor cancel remain. Re-audit rows before
+> citing them externally.
 ...
 ## 8. Cross-cutting duties
-- **AG-UI adapter**: thin interop skin over the versioned bespoke protocol (own the semantics, plug into their frontends). Do not compete on bindings.
+- **Host adapters**: thin interop skins over the versioned Run Protocol, in order of measured demand:
+  MCP server (`serveMCP`, the open W7 item), OpenAI-compatible endpoint, AG-UI. Own the semantics,
+  plug into their frontends and tool clients. Do not compete on bindings.
+- **Publish the host contract**: `AgentConfig` JSON Schema, Run Protocol reference, conformance suite.
 ...
 ## 11. What this means for developers
+| Black-box harness inside one vendor's product | A harness you can embed anywhere over MCP/HTTP, with the same receipt and replay |
```
Honest-claims addition to 08 s4 (binding note): "Interop claims name the host, version and date they
were verified on, and cite the conformance run."

### 6.3 Docs restructuring (paths under `apps/docs/src/content/docs/`)

| Path | Action |
|---|---|
| `index.mdx` | Frontmatter `description` and hero `tagline` -> one-liner + one tagline from 2.4; keep sections 01-06 and "Why a framework instead of a hand-rolled loop?" (retitle "Why a harness instead of a hand-rolled loop?"; the body already argues it); add a "Use it inside your platform" card strip once H1 ships |
| `guides/introduction.mdx` | First sentence: "TypeScript agent harness" with "framework" kept in `description` for search |
| `concepts/why-a-harness.md` (new) | What a harness is (loop, tools, context, permissions, evidence), where RA sits vs framework/runtime/SDK (table 2.2), the four differentiators (2.3), honest limits (1.5) |
| `concepts/harness-anatomy.md` (new, optional) | Map of core/control/observe/surface layers from section 1 with stability labels; replaces ad-hoc "13 capability layers" claim after verification |
| `guides/use-in-other-platforms.mdx` (new hub, after H1) | Per-host recipes (MCP hosts, Vercel AI SDK tool, LangGraph node, OpenAI-compatible clients) each with "verified on version/date" |
| `reference/run-protocol.md` (new) | Event tags, SSE framing, cursor/attach, approval/interaction, versioning rule, stability tier |
| `reference/agent-config-schema.md` (new) | Schema download, versioning, code-only fields |
| `reference/stability.md` | Refresh to 0.18; add rows for trace, diagnose, observe, ui-core protocol, server endpoints, receipts, eval |
| `guides/reactive-agents-vs-*.mdx` (4 pages) | Add "harness vs framework vs runtime" paragraph; no new competitor claims without a primary source |
| `features/a2a-protocol.md` | Update once `serveA2A` streaming status is re-verified; keep experimental |
| `packages/reactive-agents/README.md` (outside docs) | Fix "Five ... Six" counts to generated metrics; adopt one-liner |

Run `bun run repo scope` on each touched file for required check and docs lists; `check-docs-sync`
will flag code/doc drift.

## 7. Owner decisions

Each has a recommended default (marked **default**).

| # | Decision | Options | Recommended |
|---|---|---|---|
| D1 | External category term | (a) agent harness, (b) framework, (c) agentic harness SDK, (d) agent runtime | **(a)**, keep "framework" in SEO text |
| D2 | When may "Harness SDK" appear in titles | (a) never, (b) after H1, (c) after H4 conformance | **(c)** |
| D3 | Rename npm scope or CLI | (a) no, (b) add alias package, (c) rename | **(a)** |
| D4 | Hero tagline | "Agents you can audit." / "The harness you can see inside." / "Reliable on any model. Visible on every run." / other | **"Agents you can audit."** |
| D5 | Run a demand spike (issues, Discord, analytics) before building H1 | yes / no | **yes**, 1 day, zero tokens |
| D6 | First host adapter | (a) MCP server, (b) OpenAI-compatible, (c) AG-UI | **(a)** |
| D7 | Where MCP server lives | (a) `tools` impl + `ReactiveAgent.serveMCP()`, (b) new package | **(a)** (no new package without evidence, per AGENTS) |
| D8 | Tier for `ui-core` protocol and `AgentConfig` JSON Schema | (a) stable now, (b) unstable until conformance suite, (c) leave untiered | **(a) for the protocol (already additive-only), (b) for the schema** |
| D9 | Owner for `apps/cli` (`rax serve`, deploy shell) | (a) gateway-warden, (b) runtime-warden, (c) new warden | **(a)** widen existing; no new role |
| D10 | Unify `sdk-server.ts` and `server/endpoints.ts` before adding HTTP adapters | yes / no | **yes** (H2) |
| D11 | Ratify the 09/08 amendments in section 6 | all / some / none | **all except the 08 row in section 11 (marketing table), defer until H1 ships** |
| D12 | Fix drift now (README counts, stability.md v0.12) as a standalone docs PR | yes / no | **yes**, independent of the positioning decision |

## 8. Evidence index

- Packages/apps and counts: `ls packages apps`; `node` scan of `packages/*/package.json`;
  `apps/docs/src/data/metrics.json` (generated 2026-11-13T00:58Z by the docs build, test count cached).
- Endpoints: `packages/runtime/src/server/endpoints.ts` header; `packages/runtime/src/index.ts:178-186`.
- Protocol: `packages/ui-core/src/protocol/events.ts:1-9`.
- A2A: `packages/runtime/src/reactive-agent.ts:802-830`; `apps/docs/.../features/a2a-protocol.md`.
- Absent surfaces: `bun run repo find` for `chat/completions`, `StdioServerTransport`, `AG-UI`,
  `agent-protocol`, `mcp server`; `ls packages/tools/src/mcp`.
- Config schema: `packages/runtime/src/agent-config.ts:743`, `capability/config-fields.ts:95`.
- Deploy/serve: `apps/cli/src/commands/serve.ts`, `apps/cli/src/templates/sdk-server.ts`,
  `apps/docs/.../reference/cli.md`.
- Ownership: `bun run repo scope` (cli unowned).
- Web (fetched 2026-11-12): LangChain Deep Agents harness page; Claude Agent SDK overview
  (code.claude.com); OpenAI "Codex as a platform"; Pydantic "vs Mastra". Secondary and unverified
  against primary: Vercel AI SDK `HarnessAgent`, Mastra, Letta, OpenAI Agents SDK TS v0.9.1 date.
