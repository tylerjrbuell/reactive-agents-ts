---
type: design-spec
status: proposed
created: 2026-11-12
tags: [plugins, cortex, framework, hooks, compose, extensibility]
---

# Plugin system for Reactive Agents and Cortex

One small manifest, one explicit registration call, a handful of well-typed extension points. A plugin is a value you pass to the builder, not a thing that hides in a global registry. Everything it contributes is visible in `run-started.config`, tagged with its id in traces, and replayable.

Related: [[2026-11-12-cortex-workflows]] (node catalogue is an extension point here), [[../../Research/Audit-Reports-2026-11-12/gateway-channels-deploy-audit]] (the `ChannelAdapter` contract plugins implement), [[09-UNIFIED-PROGRAM]] (sequencing), `AGENTS.md` golden rules.

## 0. Prior art and prior plans (read before this spec)

Read 2026-11-12. For each: what we reuse, what this spec supersedes, where we disagree.

| Prior doc | Reused | Superseded / changed | Disagreement and why |
|---|---|---|---|
| [[2026-05-06-compose-harness-api]] (tag-namespace `Harness`: `on/tap/transform`, 12-phase `before/after/onError`, `RunHandle`, killswitch library, 4.9 lifecycle hooks) | Hooks: the 12 phases and `before/after/on-error` are the existing contract and stay the plugin hook surface. `Harness` (`core/src/services/harness-types.ts`, `harness-pipeline.ts`) and `.withHarness()` are what `withPlugin` expands into. `RunHandle` and killswitches stay the cancellation path (section 5.3). | **Shipped:** the `Harness` pipeline in core, `.withHarness()`/`.compose()` on the builder, and 5 killswitches in `packages/compose` (`confidenceFloor` from 8.6 is not among them). **Not shipped in `packages/compose`:** everything else; it is killswitches plus a registry list. The 2026-07-05 audit recorded 4/7 chokepoints observe-only and 8/12 phase hooks never invoked, `{skip}` and `inject` dead; I did not re-verify that today, so P1 starts with a spike that counts which phase hooks actually fire (zero tokens) before promising any hook point to plugin authors. | The old spec treats tags (`prompt.*`, `nudge.*`, `tool.*`...) as the extension grain. I do not expose raw tags to plugins in v1: they are an internal vocabulary with dead members, and exposing them makes that multiplicity public contract (Plan 9 sequencing rule, below). The new typed `tool.before/after`, `output` points are thin adapters over tags where a live tag exists. |
| [[2026-09-08-multi-agent-orchestration-design]] (draft; "Unified Composition Design": one spawn boundary, delegation tags, `.withSubAgents()`, Layer 3 combinators `route/fanOut/firstSuccess/quorum/budgetPerSubAgent/capDelegationDepth`; Phase 4) and Decision Index "Multi-Agent Orchestration & Teamwork" (still marked DEFERRED, Spec 16, v1.0+) | Phases 0-2 (single spawn boundary, inheritance per concern, trace lineage) are prerequisites I assume, not redo. Combinator **names** are adopted (section 5.2 renamed to match). Budget inheritance (4.5) and "inherit per concern" are the budget rules in 5.3. | Section 5 combinators are **standalone typed `Member` programs**, not `delegation.requested` transforms. The Decision Index entry is stale relative to the draft; it should be updated if this lands. | The draft makes combinators `(harness) => void` transforms applied via `.compose()`, which only work inside one agent's loop and give no typed input/output. Workflows, Autotune and library users need author-chosen, schema-typed orchestration *outside* a loop. Resolution: keep both. Layer 3 harness transforms stay the *LLM-delegation policy* surface (route/quorum on `delegation.requested`); `Member` combinators are the *program* surface; both share the same spawn boundary, budget rules and lineage. Needs owner confirmation (Q7). |
| [[2026-11-04-architecture-convergence-program]] "Extension points (plugins)" and principle 8 (modality-neutral core) | Extension points validated by the same conformance suites as built-ins; strategy = control flow only; coding-agent profile as the first composite plugin (section 11 adds Autotune as the second). Principle 8: no plugin type may assume string turns; hook views (`LlmRequestView`, `ToolOutcome`, `RunOutputView`) must be defined over typed parts, not `string`. | Plan 9 lists **acceptance check, kernel operation, guidance producer, tool-call dialect, tier profile** as extension points; v1 here adds **acceptance check** to the catalogue (4.4b) and defers the rest to "after Phase 4". | **Sequencing.** Plan 9 says a public plugin API is built on converged surfaces and packaging/versioning/sandboxing is "a separate design after Phase 4, with security review". This spec *is* that design, but I disagree with waiting to build all of it: P1 uses only surfaces that are already single-homed today (tools, skills, hooks/harness, judgment backend, slash commands) and explicitly excludes strategies, kernel operations, guidance and dialects until their Plan 9 phase lands. Recorded as an amendment need (section 13, A1). |
| [[2026-11-06-skills-and-extension-model]] | Taxonomy: **skills are content, plugins are code; plugin contains skills, never the reverse** (our declarative/code tiers follow it exactly). Skills portable (agentskills.io layout). Hooks are "the observation surface a plugin uses", profile = a plugin. | The spec's "do not build" list includes "a skill marketplace" and "plugin packaging, versioning or sandboxing (deferred after Phase 4)". Section 3.4 and 6 design packaging now; no marketplace is built, only the seam (section 10). | Tool disclosure modes (spec section 12) mean plugin tools must register into the same catalog/load module, not a parallel list; stated in 4.2. |
| [[2026-11-05-wardens-pack-design]] (Wardens: a real open-source Claude Code plugin) | Direct precedent for: one committed config file as the whole team (`wardens.yaml`) -> our one `reactive-plugin.json` manifest + one lockfile; hook-enforced authority with `warn` mode before `enforce` -> plugin permission checks ship `warn` first, with a ledger, and flip to `enforce` on evidence; `doctor --strict` lint in CI for typos, stale anchors, overlaps -> `plugin doctor` (manifest typos, `provides` mismatches, conflicts, stale engines); outcome ledger -> plugin devtools. Its lesson that consolidating authority into one file beat per-agent frontmatter. | n/a | Wardens enforce *process* on a model-driven dev team; plugin permissions govern *code in the host*. The `warn` pattern is borrowed only for permission rollout; for fail-closed hooks (6.4 item 5) we do not use warn. |
| [[2026-05-23-primitive-audit-fresh-lens]] (gaps G-G multi-agent depth, G-H workflow/DAG) | G-G and G-H are the problem statements section 5 and the workflows spec answer. Its own fork: "own it or document out of scope". | **Old `@reactive-agents/orchestration` (WorkflowEngine, event sourcing, worker pool, `requiresApproval` steps with `approveStep()/rejectStep()`; Changelog lines ~273 and ~1741) was removed**: `.withOrchestration()` was a literal no-op (P0-6, Wave 1, 2026-07-20, wither count 89->85), then the whole package was deleted in Wave 3 (-2833 LOC, v0.14 breaking, `DEBT-REGISTER.md` line ~230) as wired-to-nothing code. The registered reason is "provide-and-forget": nothing resolved the layer. | Lesson applied: the new surface must be consumed (Cortex workflows walker, compose combinators, Autotune) before it is published, i.e. "wire it AND pin it". The workflows spec and section 5 are not a revival of that engine; its approval-gate idea survives as the workflows Approval node. |
| [[08-AGENTIC-OS-NORTH-STAR]] and [[09-UNIFIED-PROGRAM]] (authority) | 08 Arc 4 "Package manager": *harness packages as publishable artifacts with a manifest; publishing a quality claim requires an attached, replayable gate receipt.* This is the plugin system's destination: a plugin's manifest may carry an optional `claims` block, and a claim is accepted by Cortex only with a replayable receipt (Autotune's report is the first example). 09 C5: "teams wait for perception" and its forward-input note that `compose` has no topology surface and nothing is authorized before RunAssessment ships (WIP=1). 08's honest-claims law governs Autotune. Ideal-architecture ([[2026-07-28-ideal-architecture]] 4.2): five extension points (tools, policy, context strategy, verifiers, observers); "if it is not one of these, it does not go in". | n/a | 09 C5 means **multi-agent combinators (section 5) are not currently authorized**. This spec cannot start them without an explicit 09 amendment (A2) or waiting for RunAssessment. Also: ideal-architecture says *verifiers* are "where RA's identity lives" and the most extensible surface; my first draft lacked it, fixed in 4.4b. Hooks map to *observers*/*policy*, tools to *tools*, judgment to *verifiers*, strategies to none of the five (so they stay experimental and last). |

Other searched hits (`extension`, `hook`, `skill`, `MCP`, `orchestration`, `killswitch` via `repo find --wiki`): [[2026-10-01-systemone-decision-backends-design]] section 5 (the two-tier judgment backend extension model: descriptor vs `JudgmentBackend` module; section 4.5 below reuses it unchanged), [[2026-10-28-plan-and-goal-primitives]] (plan/goal as meta-loop nodes; not plugin points), [[2026-08-19-lightweight-tool-index-progressive-disclosure]] (disclosure modes), [[2026-07-02-cortex-dynamic-sync-parity-run-control]] (`KillSwitchService` abort wiring, reused for the kill switch in 6.4).

## 1. Goals and non-goals

### Goals
1. Let people change framework behavior without forking: observe and gate lifecycle events, add tools, skills, strategies, judgment backends, channel adapters, providers, workflow nodes, Cortex slash commands, UI panels and themes.
2. **Explicit.** `builder.withPlugin(p, config)` is the only way in. It expands to the public withers that already exist. No import-time side effects, no auto-discovery that changes agent behavior.
3. **Observable and replayable.** Every plugin contribution carries `pluginId` in events and traces. The set of plugins (id, version, integrity hash, config hash) is recorded in `run-started.config` (AGENTS pitfall 12).
4. **Honest about trust.** In-process JS has the host's privileges. We say so, ask for permissions up front, show them, lock them, and keep a no-code tier that cannot do harm.
5. **Local-first, free, open source now**, with seams (not code) for a hosted registry, org policy and metering later.
6. **Prove it by dogfood.** Autotune (section 11) ships as a first-party plugin plus a meta agent. If the API cannot express it, the API is wrong.

### Non-goals (v1)
- No marketplace, no payments, no hosted registry, no ratings. We keep the `PluginSource` interface open (section 10), nothing more.
- No sandbox that stops malicious in-process code. We do not claim one (section 6).
- No plugin-defined termination logic, no plugin-owned kernel loop, no new run-ender. Plugins propose through typed rails; the shared terminal path decides (AGENTS pitfall 12).
- No arbitrary patching of framework internals (monkey-patching, module replacement). If a plugin needs a seam that does not exist, we add the seam, typed, to the framework.
- No new "kitchen sink" lifecycle: we add a few missing hook points, not a second event system.
- Not a Claude Code plugin clone. The `/plugin` UX is familiar; the contract is Effect-typed and builder-explicit.

Simplicity rule for review: if an extension point cannot be described in one TypeScript interface of under ~15 members and one conformance test file, it is not v1.

## 2. Honest inventory: what exists, what a plugin author cannot do today

Read from code on 2026-11-12. "Exists" means a public API; "gap" means a plugin author would have to fork or patch.

| Area | Exists today | Gap for a plugin author |
|---|---|---|
| Lifecycle hooks | `.withHook(LifecycleHook)` in `packages/runtime/src/builder.ts` (`withHook` delegates to `withHarness(applyHookRegistration(...))`). `LifecycleHook = {phase, timing, handler(ctx: ExecutionContext)}` in `packages/runtime/src/types.ts`. 12 phases: `bootstrap guardrail cost-route strategy-select think act observe verify memory-flush cost-track audit complete`; timings `before`, `after`, `on-error`. Handler may be plain, Promise or Effect and may return a modified context. `agent.compose(h => h.tap('observation.tool-result', fn))` and `h.before/h.after` exist on the `Harness`. | No hook per tool call or per LLM request (only the coarse `act`/`think` phases). No typed veto/rewrite result (a hook "modifies" an untyped context). No `on-output` or `on-approval`. Hooks have no identity: a thrown error surfaces as `HookError` with no owner. |
| Compose | `packages/compose` = 5 killswitches (`budgetLimit timeoutAfter maxIterations requireApprovalFor watchdog`) and `killswitches.list()`. `agent.compose(...)` takes killswitches or a harness function. | **No graph, no combinators, no multi-agent composition.** `compose` composes policies on one agent, not agents. Nothing like sequence/parallel/race/router exists. |
| Tools | `defineTool()` (`packages/tools/src/define-tool.ts`), `defineToolset`, ToolService; 9 capability + 9 meta built-ins. `.withTools({...})`. | No packaging unit: a tool ships as app code. No per-tool permission declaration (host/fs/env), so approval policy cannot be derived from the tool itself. |
| MCP | `.withMCP(catalogName \| config)`; docker/stdio/http transports; Cortex has MCP discovery and `/mcp`. | MCP is today's de facto plugin channel for tools, and a good one: out-of-process, language-agnostic. It cannot add hooks, skills, strategies or UI. |
| Skills | `apps/docs/skills` (consumer), `.withSkills(SkillsOptions)`, skill roots in Cortex (`agent-skills.ts`, `skill-directories.ts`), Cortex Skills tab, living skills. | Skills are directory-based and path-configured, not versioned or distributable with other assets. |
| Sub-agents / multi-agent | `.withAgentTool(name, agent)`, `.withDynamicSubAgents({maxIterations,maxRecursionDepth})` (`spawn-agent` tool), `.withRemoteAgent(name, url)` (A2A); machinery in `packages/runtime/src/builder/build-effect/` (`sub-agent-executor.ts`, `spawn-handlers.ts`, `local-agent-tools.ts`, `remote-agent-tools.ts`, `child-spend-probe.ts`). `packages/a2a`, `packages/gateway`. | Delegation is LLM-driven only (a parent agent *chooses* to call a sub-agent tool). There is no deterministic, typed, budgeted way to say "run A then B", "run A and B and merge", "race", "fallback", "route by judgment". Every orchestration is prompt engineering. |
| Strategies / kernel | `StrategyRegistry.register(name, fn)` and `registerKernel(name, kernel)` in `packages/reasoning/src/services/strategy-registry.ts`; `ReasoningService.registerStrategy`. `packages/reasoning` exports `dist`. | Registration exists but is service-level (Effect), not reachable from the builder as a declared, id-tagged contribution. Kernel phases are internal; terminal ownership is in `loop/terminate.ts`. |
| Judgment | `JudgmentBackend {name, evaluate, listModels?, capabilities?}` and `makeJevBackend`, `makeLlmBackend`, `makeOllamaBackend`, `makeSystemOneHttpBackend` in `packages/judgment`. `.withJudgment(options)`. | Backend is swappable in code; no declared packaging; `calibrated` capability must be honest and is today self-reported. |
| Providers | `LLMService`, provider layers, `ProviderAdapter` hook contract in `packages/llm-provider/src/adapter.ts` (model-quirk adapter: continuation hints etc.). | Adding a provider means a Layer in the llm-provider package. No external registration path. |
| Channels | `MessageChannel`/`ChannelService` in `packages/channels`, only `WebhookChannelAdapter` ships; Signal/Telegram go through MCP push (audit: "two channel paths"). Canonical `ChannelAdapter` + conformance suite is audit item #6, not built. | Plugins cannot add a channel until #6 lands. This spec depends on it and does not redefine it. |
| Cortex | Overlays through `build-cortex-agent.ts` / `cortex-agent-source.ts`; chat slash commands as a closed `ChatCommandName` union in `apps/cortex/ui/src/lib/chat-commands.ts`; palette in `palette-commands.ts`; Lab tabs as a closed `LAB_TABS` list. | Slash commands, palette entries, Lab tabs and panels are closed unions in UI source. A plugin cannot add one without editing Cortex. |
| Repo-level "plugin" ideas | `.claude/` and `.agents/skills/` are Claude Code and contributor tooling (warden agents, repo skills); the `wardens` plugin is Claude Code's, not ours. `create-reactive-agent` scaffolds apps, no plugin template. | No framework plugin concept exists. Nothing to migrate; nothing to stay compatible with. |

Biggest honest finding: **the framework is already extensible in code, but extension is unpackaged, unidentified and unpermissioned.** The plugin system is mostly a packaging, identity and trust layer over existing seams, plus a few new typed seams (tool/LLM/output/approval hooks, combinators, Cortex registries). That is why it can stay small.

## 3. Plugin model

### 3.1 Two tiers

| Tier | Contents | Executes code | Trust |
|---|---|---|---|
| **Declarative** | Skills, prompts, MCP server entries, workflow templates, slash-command prompt templates, themes, declarative panels, config schema. JSON/Markdown only. | No. Cortex reads files and validates them against schemas. | Safe by construction. Install needs only a normal confirm. Still shows what it adds (an MCP entry spawns a process; that is a permission, see 6.2). |
| **Code** | Everything above plus hooks, tools, strategies, judgment backends, channel adapters, providers, workflow node runners, combinator-based macros. | Yes, in-process JS/TS. | Trusted code. Full permission review at install. Honest warning text (section 6). |

The tier is derived, never declared: a manifest with an `entry` is a code plugin.

### 3.2 Manifest

One file, `reactive-plugin.json` (also `package.json#reactiveAgents` for npm packages). Static, readable without executing any code. This is what the install UI, lockfile and compat checks use.

```ts
// @reactive-agents/plugin  (new small package, deps: core only; see Q1)
import { Schema } from "effect";

export const PluginManifest = Schema.Struct({
  id: Schema.String,                       // "acme.slack-notify": lowercase, dot-namespaced, immutable
  name: Schema.String,
  version: Schema.String,                  // semver
  description: Schema.String,
  license: Schema.String,
  engines: Schema.Struct({                 // compat ranges, checked at install AND enable
    "reactive-agents": Schema.String,      // "^0.18.0"
    cortex: Schema.optional(Schema.String),
    plugin: Schema.Number,                 // plugin API major (starts at 1)
  }),
  entry: Schema.optional(Schema.String),   // absent => declarative; "./dist/index.js" exporting `default: Plugin`
  provides: Schema.Struct({                // what it contributes; drives UI and permission cross-check
    hooks: Schema.optional(Schema.Array(Schema.String)),         // "tool.before", "run.output", ...
    tools: Schema.optional(Schema.Array(Schema.String)),
    skills: Schema.optional(Schema.Array(Schema.String)),        // relative dirs
    strategies: Schema.optional(Schema.Array(Schema.String)),
    judgmentBackends: Schema.optional(Schema.Array(Schema.String)),
    channelAdapters: Schema.optional(Schema.Array(Schema.String)),
    providers: Schema.optional(Schema.Array(Schema.String)),
    workflowNodes: Schema.optional(Schema.Array(Schema.String)),
    slashCommands: Schema.optional(Schema.Array(Schema.String)), // Cortex
    panels: Schema.optional(Schema.Array(Schema.String)),        // Cortex
    themes: Schema.optional(Schema.Array(Schema.String)),
    mcpServers: Schema.optional(Schema.Array(Schema.String)),
  }),
  permissions: Schema.optional(Permissions),                     // section 6.2
  config: Schema.optional(Schema.Unknown),                       // JSON Schema for user config; fields may be {"secret": true}
});
```

Rules: `provides` must match what `apply` actually registers (checked in dev mode and by the conformance kit; a mismatch at runtime is a `PluginContractViolation` event and the plugin is disabled). Config values never contain secrets: a secret field stores a **reference** (`{ "$secret": "SLACK_TOKEN" }`) resolved from Cortex's key store or env at enable time and injected as `Redacted`.

### 3.3 Entry point and registration

A code plugin default-exports a typed factory. It does not touch globals; it receives a narrow context and returns contributions.

```ts
export interface Plugin<Config = unknown> {
  readonly manifest: PluginManifest;      // same data as the file, for typed in-repo plugins
  /** Pure-ish: validate config, return contributions. May yield Effect for async setup. */
  readonly setup: (ctx: PluginContext<Config>) => Effect.Effect<Contributions, PluginSetupError, Scope.Scope>;
}

export interface PluginContext<Config> {
  readonly id: string;
  readonly config: Config;                          // validated against manifest.config
  readonly secrets: (key: string) => Effect.Effect<Redacted.Redacted<string>, SecretNotGranted>;
  readonly log: PluginLogger;                       // tagged with pluginId; goes to the trace, not console
  readonly fetch: typeof fetch;                     // host-allowlisted wrapper (6.2); raw global fetch stays reachable in v1, see 6.4
  readonly clock: Clock.Clock;
}

export const definePlugin = <C>(p: Plugin<C>): Plugin<C> => p;   // identity; exists for inference + docs
```

Registration is explicit and expands to existing withers:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withPlugin(slackNotify, { channel: "#ops", token: { $secret: "SLACK_TOKEN" } })
  .withPlugin(autotune)                 // declarative+code, no config
  .build();
```

`withPlugin` does exactly this, in declaration order, and nothing else:
1. Check `engines` and the lockfile integrity entry (if present).
2. Validate config; resolve secret references.
3. Run `setup` inside the agent's `Scope` (closed on agent dispose: no leaked resources).
4. Apply each contribution through a public wither: hooks via `withHook`, tools via `withTools`/`defineTool` registrations, skills via `withSkills`, MCP via `withMCP`, strategies via `registerStrategy` at build, judgment via `withJudgment`. Each registration is wrapped so events/traces carry `pluginId`.
5. Append `{id, version, integrity, configHash, provides}` to `plugins[]` in `run-started.config`.

Conflicts are errors, not last-write-wins: two plugins registering tool `search`, strategy `x`, or a slash command `/x` fail `build()` with `PluginConflictError` naming both ids. Ordering of hooks across plugins is declaration order (same as `withHook` today).

`withPlugin` is **additive sugar**: any plugin can be replaced by the equivalent hand-written builder calls. This is the test that we are not adding hidden machinery.

### 3.4 Packaging and sources

| Source | Form | Notes |
|---|---|---|
| npm | `@scope/name` | Installed to the workspace plugin dir with `--ignore-scripts` always. |
| git | `git+https://...#<commit-sha>` | Must pin a commit sha or tag resolving to a sha; branches refused. |
| local folder | `./path` or `file:` | For development. Marked "unverified, local" in UI. Integrity hash recomputed on change; change forces re-approval. |

Install location: `<cortex-data>/plugins/<id>/<version>/` for Cortex, `node_modules` for plain library use. Library users can skip all of this and `import` a plugin like any package: the Cortex lifecycle below is Cortex's management layer, the framework only needs `withPlugin`.

### 3.5 Lifecycle (Cortex-managed)

`install` (fetch, verify, show manifest + permissions, user approves, write lockfile entry; **nothing executes**) -> `configure` (form from config schema, secrets by reference) -> `enable` (compat check, `setup` dry-run in health check, mark enabled per workspace or per agent) -> `disable` (stop contributing at next agent build; running runs finish) -> `update` (new version = new permission diff + new integrity; never automatic) -> `uninstall` (remove files; keep config and run history, which reference `id@version`).

States: `installed | enabled | disabled | errored | quarantined`. `quarantined` = kill switch or failed integrity; cannot be enabled without explicit user action.

## 4. Extension point catalogue (v1)

Each point has one interface and one conformance suite. Stability labels follow `reference/stability.md`.

### 4.1 Hooks (stable path + three new typed points)

Existing `LifecycleHook` keeps working. Plugins use the same shape plus an id. New typed points are added **as `Harness` taps with typed results**, owned by core/runtime, because untyped context mutation is how plugins break each other.

```ts
export interface PluginHooks {
  readonly lifecycle?: ReadonlyArray<LifecycleHook>;           // existing: phase/timing/handler
  readonly tool?: {
    /** Before a tool executes. Observe, rewrite args, or deny. Runs after guardrails, before approval. */
    readonly before?: (c: ToolCall) => Effect.Effect<ToolBeforeResult>;
    readonly after?: (c: ToolCall, r: ToolOutcome) => Effect.Effect<ToolAfterResult>;
  };
  readonly llm?: {
    readonly before?: (r: LlmRequestView) => Effect.Effect<void>;                 // observe only in v1
    readonly after?: (r: LlmRequestView, c: LlmCompletionView) => Effect.Effect<void>;
  };
  readonly output?: (o: RunOutputView) => Effect.Effect<OutputDecision>;           // on final answer, pre-delivery
  readonly approval?: (a: ApprovalRequestView) => Effect.Effect<ApprovalAdvice>;   // advise only; a human/policy still decides
}

export type ToolBeforeResult =
  | { readonly _tag: "Continue" }
  | { readonly _tag: "Rewrite"; readonly args: unknown }         // re-validated against the tool schema
  | { readonly _tag: "Deny"; readonly reason: string };          // becomes a normal tool error, traced, not a throw
export type OutputDecision =
  | { readonly _tag: "Accept" }
  | { readonly _tag: "Annotate"; readonly note: string }         // attached to the receipt
  | { readonly _tag: "Propose"; readonly rail: TypedRail };      // asks the shared terminal path; plugin never ends the run
export type ApprovalAdvice = { readonly _tag: "None" } | { readonly _tag: "Recommend"; readonly decision: "approve" | "deny"; readonly why: string };
```

Rules: `llm.before/after` are observe-only in v1 (no prompt rewriting; context assembly stays owned by `assembly/project.ts`). `approval` can only *advise*; auto-approving is a policy decision made in Cortex's approval policy, not by plugin code. Hook failures are isolated per plugin: a failing `tool.after` emits `PluginHookFailed{pluginId, point}` and, by default, continues; the manifest may declare `critical: true` to fail the run instead (visible in install UI). Each hook has a per-call timeout (default 5s) and appears in the devtools view with duration.

### 4.2 Tools

```ts
tools?: ReadonlyArray<DefinedTool>   // from defineTool(); name auto-namespaced "<pluginId>/<name>" in traces, short name for the model
```
Permissions come from the manifest (hosts, fs roots, env), and the tool executes through the standard `ToolService` path, so guardrails, approval, timeouts and the effect ledger apply unchanged. Plugin tools are marked `source: { pluginId }` in the tool registry, so Cortex shows provenance. They register into the same catalog/load module as built-ins so tool disclosure modes (`all|index|discover`) apply to them; no parallel list.

### 4.3 Skills (declarative)

`provides.skills: ["./skills/code-review"]`: directories with `SKILL.md`. Installed skills appear in Cortex Skills tab under the plugin's name, read-only, and activate through the existing skills machinery (`withSkills`, `SkillActivated`). A plugin skill cannot overwrite a workspace skill of the same name; conflict is surfaced.

### 4.4 Strategies and kernel phases (expert, trusted code only, `experimental`)

```ts
strategies?: ReadonlyArray<{ readonly name: string; readonly run: StrategyFn }>   // registered via StrategyRegistry.register
```
- Allowed: a new strategy composed from existing kernel capabilities, selected with `.withReasoning({ defaultStrategy })`.
- **Not allowed**: kernel phases, guards, termination or outcome logic (Pruning Principle; `terminate.ts` is the single terminal owner; AGENTS pitfall 12). A strategy returns a result through `finalizeStrategyResult` like built-ins; the conformance suite fails any strategy that sets a terminal status itself. Plugins that want to change *how a run ends* use `output` -> `Propose(rail)`, and the shared path decides.
- Because `packages/reasoning` exports `dist`, plugin strategies compile against the published type surface, which is what we want.

### 4.4b Acceptance checks / verifiers

Added after reading [[2026-11-04-architecture-convergence-program]] and [[2026-07-28-ideal-architecture]], which name verifiers as the most valuable extension surface.

```ts
acceptanceChecks?: ReadonlyArray<{
  readonly name: string;
  readonly check: (run: RunEvidenceView) => Effect.Effect<{ readonly pass: boolean; readonly evidence: string }, CheckError>;
}>
```
Deterministic "is it done" checks (tests pass, file matches schema) that the terminal exit gate *disposes with*; the plugin never ends the run. Depends on the Plan 9 Phase 2b exit gate; not in P1. Until then, `output` -> `Annotate`.

### 4.5 Judgment backends

```ts
judgmentBackends?: ReadonlyArray<JudgmentBackend>   // existing interface in packages/judgment/src/types.ts, unchanged
```
`capabilities.calibrated` must be truthful. Cortex shows "uncalibrated" for plugin backends unless the eval kit's calibration check (reliability curve on a fixture set) passes and the result is stored. Consumers (workflows Judge node, router combinator) already branch on `calibrated` (see workflows spec decision Q4).

### 4.6 Channel adapters

```ts
channelAdapters?: ReadonlyArray<ChannelAdapter>   // the canonical contract from audit item #6: InboundEnvelope, send -> DeliveryReceipt, typed ChannelError, capabilities, state stream, scoped start
```
Hard dependency: audit #5/#6 (typed receipts, canonical adapter, conformance suite). Until then no channel plugins; the conformance suite `runAdapterConformance` is the plugin acceptance test. Credentials arrive as `Redacted` through `ctx.secrets`.

### 4.7 Providers (`experimental`)

```ts
providers?: ReadonlyArray<{ readonly name: string; readonly layer: Layer.Layer<LLMService> ; readonly adapter?: ProviderAdapter }>
```
A provider plugin supplies the `LLMService` layer it implements (the `complete`/`stream`/`embed` contract in the `llm-api-contract` skill) and an optional `ProviderAdapter` for model quirks. Declared under `permissions.network`. Cut first if capacity is short (section 12).

### 4.8 Workflow nodes

```ts
workflowNodes?: ReadonlyArray<{
  readonly type: string;                              // "acme.slack-post"
  readonly configSchema: Schema.Schema<unknown>;      // drives the node inspector form
  readonly inputSchema: Schema.Schema<unknown>;
  readonly outputs: Readonly<Record<string, Schema.Schema<unknown>>>;   // named ports, typed
  readonly sideEffects: "none" | "idempotent" | "non-idempotent";       // feeds the workflows tool-effect ledger
  readonly run: (input: unknown, config: unknown, ctx: NodeContext) => Effect.Effect<NodeOutput, NodeError>;
}>
```
Same node contract the built-in catalogue in [[2026-11-12-cortex-workflows]] section 4 uses; built-ins are just first-party nodes. Typed ports mean the editor validates edges for plugin nodes exactly as for built-ins. A node that needs an agent calls it through `NodeContext.runAgent`, which goes through the combinator `Member` contract (section 5), so cost, trace and cancellation are inherited.

### 4.9 Cortex slash commands

Replace the closed `ChatCommandName` union with data plus a registry; built-ins register through the same function.

```ts
slashCommands?: ReadonlyArray<{
  readonly name: string;                      // /kebab-case, no collision with built-ins or other plugins
  readonly summary: string;
  readonly arg?: string;
  readonly kind: "prompt" | "action";
  /** kind "prompt": expands to a user message template (declarative tier OK). */
  readonly template?: string;
  /** kind "action": server-side handler returning a typed chat effect; code tier only. */
  readonly handle?: (args: string, ctx: ChatCommandContext) => Effect.Effect<ChatEffect, CommandError>;
}>
type ChatEffect =
  | { _tag: "Message"; markdown: string }                      // render a card/text in the transcript
  | { _tag: "Confirm"; card: ConfirmCard; onConfirm: ActionRef } // permission-style confirmation card
  | { _tag: "RunAgentTurn"; prompt: string }
  | { _tag: "Navigate"; to: string };
```
`kind: "prompt"` is the 80% case and needs no code. Action handlers run on the Cortex server, never in the browser. The same entries feed the palette.

### 4.10 Cortex UI panels: declarative schema, not iframe (decision)

**Chosen: declarative panels** rendered by Cortex with its own components. A panel is `{id, title, placement: "lab-tab" | "run-view" | "chat-side", source}` where `source` is a plugin data endpoint (a tool or action returning JSON) plus a view tree from a closed set: `table`, `markdown`, `keyvalue`, `chart` (line/bar), `form` (bound to an action), `status-list`, `diff`.

Why not a sandboxed iframe in v1: (1) an iframe plus `postMessage` bridge is a second UI runtime, theme engine and security boundary to build and keep correct; (2) the dominant plugin UI needs (show a table, a status list, a form that calls an action) fit a closed schema; (3) a declarative panel keeps the "declarative tier cannot run code" promise intact; (4) it inherits Cortex's design system and accessibility for free. Cost: no bespoke visualizations. Escape hatch designed in, not built: `view: { type: "frame", src, sandbox }` reserved for a later version, behind its own permission (`ui.frame`) and `sandbox="allow-scripts"` without `allow-same-origin`.

### 4.11 Themes

Declarative token overrides on the Cortex design-system CSS variables; validated against the token list; contrast-checked at install (warn). No CSS injection.

### 4.12 What is deliberately not an extension point
Prompt templates for the kernel system prompt, context assembly, termination, entropy scoring, memory consolidation, the approval decision itself. Each is a place where a plugin could silently degrade every run. Request a seam via an issue; it will be added typed or declined.

## 5. Multi-agent combinators (first-party, in `packages/compose`)

Today `packages/compose` composes **policies on one agent**. It has no graph, no combinators, no multi-agent composition (section 2). We add combinators there because plugins, workflows, Autotune and plain library users all need the same thing, and compose-warden already owns the package. Plugins consume them; they are not plugin-only.

### 5.1 The contract: `Member`

```ts
/** A runnable unit with a typed contract. An agent, a function, another combinator, or a remote agent. */
export interface Member<I, O> {
  readonly id: string;                                     // stable label in traces: "writer", "reviewer"
  readonly input: Schema.Schema<I>;
  readonly output: Schema.Schema<O>;                       // agents must use .withOutputSchema; extraction failure = typed MemberOutputInvalid
  readonly run: (input: I, opts: RunOpts) => Effect.Effect<MemberResult<O>, MemberError>;
}
export interface RunOpts {
  readonly budget?: { readonly maxCostUsd?: number; readonly maxTokens?: number; readonly maxMs?: number };
  readonly parent: TraceIdentity;                          // {runGroupId, parentRunId, memberPath: ["supervise","worker[2]"]}
}
export interface MemberResult<O> { readonly value: O; readonly runId: string; readonly costUsd: number; readonly status: "ok" | "partial" }

export const member: {
  agent<I, O>(agent: ReactiveAgent, io: { input: Schema.Schema<I>; output: Schema.Schema<O>; task: (i: I) => string; id: string }): Member<I, O>;
  fn<I, O>(id: string, io: {...}, f: (i: I) => Effect.Effect<O, MemberError>): Member<I, O>;  // deterministic steps, zero tokens
  remote<I, O>(id: string, url: string, io: {...}): Member<I, O>;                              // A2A
};
```

### 5.2 Combinators (each is a function returning a `Member`)

Names follow [[2026-09-08-multi-agent-orchestration-design]] Layer 3 where they overlap: `parallel` is `fanOut`, `race` is `firstSuccess`, `router` is `route`, and `quorum(members, n)` is added (n agreeing results). `budgetPerSubAgent` and `capDelegationDepth` stay harness-level policies from that draft. Sequencing caveat: 09 C5 does not yet authorize multi-agent topology work (section 0, A2).

| Combinator | Semantics | Failure / cancel |
|---|---|---|
| `sequence(a, b, ...)` | Output of each feeds next; types checked at compile time (`Member<A,B>` then `Member<B,C>`). | First failure stops; later members never start. |
| `parallel({a, b, c}, {concurrency})` | Same input to all (or mapped per key), result `{a: Oa, b: Ob, ...}`. Bounded concurrency. | `onError: "fail-fast" \| "collect"`; fail-fast interrupts siblings. |
| `race(a, b, ...)` | First success wins, losers interrupted and their spend accounted. | All fail -> `AllMembersFailed` listing each. |
| `fallback(primary, ...rest)` | Try in order on typed failure or `status:"partial"` when `acceptPartial:false`. | Records which member answered. |
| `router(question, routes)` | Classify with `JudgmentService.ask` (`choice` spec), run the chosen member. Below `minConfidence` (0.6 calibrated / 0.8 uncalibrated, same defaults as the workflows Judge node) route to `uncertain` member or fail typed. | Judgment errors are typed; backend `calibrated` recorded in trace. |
| `supervisor(plan, worker, opts)` | A planner member returns a typed list of subtasks; workers run (bounded); a reducer member merges. Max depth and fan-out are required options. | Worker failures reported to supervisor once (one repair round), never loops silently. |
| `debate / verify(proposer, verifier, opts)` | `verify`: proposer output must pass verifier member returning `{ok, issues}`; up to `maxRounds` (required, hard cap 5). `debate` = N proposers + judge member. | Cap reached -> returns last output with `status:"partial"` and `issues`; never an infinite loop. |
| `mapReduce(items, mapper, reducer, opts)` | Mapper runs per item (bounded concurrency), reducer folds. | Per-item failure policy `skip \| fail`; skipped listed in result. |

### 5.3 Semantics common to all
- **Typed edges.** Schemas are checked where members connect; a mismatch is a type error in TypeScript and a `MemberSchemaMismatch` at runtime for dynamic (JSON) members.
- **Budgets.** A combinator budget is a ceiling over its members: child budgets are derived (min of own and remaining), spend rolls up using the same child-spend accounting sub-agents use (`child-spend-probe.ts`). Exceeding it interrupts remaining members and returns `BudgetExceeded` with partial results attached.
- **Cancellation.** Effect fiber interruption end to end; wired to the `RunHandle`/killswitch path, so `timeoutAfter`, `budgetLimit` and the user's Stop button reach every member. Race/parallel losers are interrupted, not abandoned.
- **Trace identity.** Every member run is a normal agent run with its own `runId`, carrying `{runGroupId, parentRunId, memberPath}`. Cortex groups them as a tree under the combinator run; `rax-diagnose cause <runId>` works on any member. Plugin-authored combinators carry `pluginId`.
- **No hidden LLM calls.** Only `router` and agent members spend tokens; combinator plumbing is deterministic.
- **Termination stays in the shared path.** A member's run ends through its own terminal path; combinators only compose *results*.

### 5.4 Relation to sub-agents and the workflow graph

- **Sub-agents** (`withAgentTool`, `withDynamicSubAgents`, A2A) remain the **LLM-chosen** delegation path: the model decides at runtime. Combinators are the **author-chosen, deterministic** path. A combinator can be exposed to an LLM as a tool (`asTool(combinator)`), unifying the two without changing either.
- **Direction decision: combinators lower to the workflow graph, not the reverse.** A combinator tree is a pure data structure (members and edges with schemas), so `toWorkflow(combinator)` emits a graph for viewing, saving, durable execution and the editor. The reverse (graph to combinators) is not promised: workflows have durable waits, approval and ask-user nodes, cron/webhook triggers and resume-after-crash, which in-process combinators do not and should not model. Justification: one way is lossless and cheap; the other way would force combinators to carry persistence they do not need, and duplicates the walker. The workflow Parallel/Join/If/Loop nodes keep their own walker semantics (durable); the *Agent node's* run path and the router/verify behaviors share the `Member` contract so costs, schemas and traces behave the same.
- Phase fit: combinators ship in the compose package before or with workflows Phase 1, so the first workflow slice can use `sequence`/`router` members instead of private glue. If workflows slip, combinators still serve library users and Autotune.

## 6. Security and trust (the biggest risk)

### 6.1 Honest threat model
A code plugin is arbitrary JavaScript in the Cortex server or the user's agent process. It can read files, make network calls, read `process.env`, spawn processes, patch prototypes. **v1 cannot stop that.** We will not describe permissions as a sandbox. What we can do is: make requests explicit, review them, pin them, narrow what the framework hands over by default, record what happens, and give a kill switch. The real security boundary in v1 is **the user's decision to trust a source**, plus the declarative tier for everyone who does not need code.

### 6.2 Permission manifest

```ts
export const Permissions = Schema.Struct({
  network: Schema.optional(Schema.Array(Schema.String)),      // hosts: "api.slack.com", "*.example.com"
  filesystem: Schema.optional(Schema.Struct({
    read: Schema.optional(Schema.Array(Schema.String)),       // roots; "workspace" token = current workspace dir
    write: Schema.optional(Schema.Array(Schema.String)),
  })),
  secrets: Schema.optional(Schema.Array(Schema.String)),      // key names it may resolve via ctx.secrets
  env: Schema.optional(Schema.Array(Schema.String)),          // env var names
  shell: Schema.optional(Schema.Boolean),                     // spawns processes, incl. MCP stdio/docker servers
  tools: Schema.optional(Schema.Array(Schema.String)),        // existing tool names its hooks may observe/rewrite/deny
  hooks: Schema.optional(Schema.Array(Schema.String)),        // hook points used; "tool.before" is called out as "can alter tool calls"
  ui: Schema.optional(Schema.Array(Schema.String)),           // "panel", "slash-command", "theme"
});
```
What is **enforced** in v1: `secrets` (only listed keys resolvable through `ctx.secrets`), `tools` and `hooks` (framework only passes matching events), `ctx.fetch` host allowlist and `ctx.fs` rooted access *for code that uses the context helpers*, declarative-tier schema validation, MCP entries (the shell permission gates adding the server). What is **not enforced**: anything the plugin reaches through raw `fetch`, `node:fs`, `process.env` or `child_process`. The install UI says this in one plain sentence beside the permissions list, and labels the plugin "Trusted code".

Permission **changes** on update are blocking: the update card shows a diff (`+ network: api.new.com`, `+ shell`) and requires explicit approval. Narrowing is silent-OK.

### 6.3 Supply chain
- `reactive-plugins.lock` (JSON, committed): `{id, version, source, resolved (sha or tarball url), integrity (sha512 of the extracted tree), manifestHash, approvedPermissions}`. Loader refuses an entry whose recomputed integrity differs: `quarantined`, with the reason.
- **No install scripts**, ever: npm installs run with `--ignore-scripts`; git installs do not run build steps (plugins publish built output).
- **Pinned sources**: git needs a sha; npm resolves to an exact version + integrity. No `latest`, no ranges in the lockfile.
- **Never auto-update.** Cortex may *check* and show "update available"; applying is a user action with the permission diff.
- **Signed/verified sources**: v1 = verification by *source identity* (npm provenance attestation / Sigstore where available, git commit signature where available, shown as "verified publisher" or "unverified"). A first-party allowlist (`@reactive-agents/*` and our org) is marked "first-party". We do not build our own signing PKI until a registry exists (section 10).
- Local-folder plugins are always "unverified, local" and re-approved on content change.

### 6.4 Containment we do ship
1. **Per-plugin kill switch**: one toggle (and `/plugin disable <id>`) removes its contributions at the next agent build and, via the registry, makes in-flight hook/tool calls return `Continue`/fail-closed for new invocations. A plugin that throws or times out N times in a window is auto-`quarantined` and the user is told.
2. **Isolation of failure**: each hook/tool/node call runs with a timeout, error boundary and its own fiber; a plugin cannot crash a run or block the loop beyond its timeout.
3. **Attribution**: every event, trace span, tool call and cost line from plugin code carries `pluginId` (section 8).
4. **Least privilege defaults**: plugin contexts get no secrets, hosts or roots by default.
5. **Fail-closed denies**: for `tool.before` `Deny` and guardrail-adjacent hooks, a plugin error means *deny/hold*, not allow, when the manifest marks the hook `critical`.

### 6.5 Later isolation (designed for, not built)
Subprocess or worker isolation per plugin (`runtime: "isolated"` in manifest), with RPC for the extension points whose inputs/outputs are already serializable schemas (tools, hooks, nodes, judgment, channel adapters all are by design, which is why they take `Schema`s and not closures over host objects). The v1 API is written so it can be routed over RPC later without changing plugin source. Providers and strategies stay in-process only.

### 6.6 Other rules
Plugins cannot register things that bypass guardrails, approvals or killswitches: their tools run through `ToolService`, their combinator members run through normal runs. Prompt-injection through plugin skill content is the same class as any skill; skills are shown at install. A plugin cannot read another plugin's config or secrets.

## 7. Cortex UX

### 7.1 Plugins manager (`/plugins`, new Lab tab "Plugins")
- **Installed** list: name, version, tier badge (Declarative / Trusted code), source badge (first-party / verified / unverified / local), state, what it adds (icons per `provides`), last health check.
- **Detail**: description, permissions (grouped, with the "not a sandbox" line), contributed items (each links to where it appears: a Skills tab entry, a tool in Tools, a node in the workflow editor), **config form generated from the JSON Schema** (secrets render as a key picker bound to the key store, never a text box), enable/disable per workspace or per agent, update with permission diff, uninstall.
- **Health**: last `setup` result, hook error rates, p95 hook duration, quarantine reason.
- **Logs**: the plugin's `ctx.log` stream, filterable, plus its events from the run trace.
- **Browse**: local registry only in v1: first-party plugins shipped with Cortex (a `plugins/` folder) and anything the user points at. "Install from source" accepts npm/git/path. The Browse tab is backed by the `PluginRegistry` interface (section 10) so a hosted one slots in later.

### 7.2 `/plugin` chat command
Registered through the same slash-command registry (4.9). Built-in, first-party, action kind.

```
/plugin                       list installed, with state
/plugin info <id|source>      manifest, permissions, what it adds (works on a not-yet-installed source: fetches manifest only, no code runs)
/plugin install <source>      -> confirmation card (below); on approve: install + lockfile + (optional) enable
/plugin enable <id>   /plugin disable <id>
/plugin config <id>           opens the generated config form
/plugin remove <id>
/plugin update [<id>]         shows version + permission diff per plugin; approve each
```
**Confirmation card** (a `ChatEffect.Confirm`): plugin name/version/publisher, source and trust badge, tier, permissions as a checklist with new/changed highlighted, "adds: 2 tools, 1 skill, 1 slash command, 1 hook (tool.before: can alter tool calls)", integrity hash prefix, the sentence "This plugin runs code with the same access as Cortex" for the code tier, and [Install] [Install and enable] [Cancel]. The agent chat controls follow the existing proposal model (`chat-proposal-service.ts`): an agent may *propose* `/plugin install`, the user approves; the agent can never install silently, and `/agent` mode does not widen this.

### 7.3 Plugin-provided surfaces
- **Slash commands** appear in the `/` menu with a small plugin badge and in the palette; collisions show at enable time, not at typing time.
- **Workflow nodes** appear in the editor's node palette under a "Plugins" group with their typed ports and an "uses network: api.slack.com" chip derived from permissions.
- **Panels** appear as Lab tabs, run-view tabs or chat side panels per `placement`, titled with a plugin badge.
- **Tools** appear in `/tools` and the Tools tab with provenance; **skills** in the Skills tab.

### 7.4 Plugin devtools
A "Plugins" tab in the run view (and Inspector): a timeline of every plugin hook invocation for the run: point, plugin id, input summary, decision (`Continue/Rewrite/Deny`), duration, error. "What did the plugins do to this run?" is one screen. Rewrites show before/after. This is also the debugging tool for plugin authors.

## 8. Observability and replay

- **Events** (additive, core-warden): `PluginLoaded{pluginId,version,integrity}`, `PluginHookInvoked{pluginId,point,decision,durationMs}`, `PluginHookFailed`, `PluginQuarantined`, `PluginContractViolation`. Existing events emitted by plugin-registered tools/nodes carry optional `pluginId`.
- **Traces**: spans from plugin code are tagged `plugin.id`; cost attributed per plugin (a plugin that calls LLMs via members shows in the run's cost breakdown).
- **`run-started.config`** gains `plugins: [{id, version, integrity, configHash, provides}]`. `configHash` is of the non-secret config; secret references are recorded by key name only. `rax-diagnose` and the replay package can therefore say "this run ran with plugin X@1.2.0".
- **Replay**: `replay` reconstructs from the recorded run. Plugin *decisions* (hook results, rewrites, denies) are recorded as events and replayed from the record, not by re-running plugin code, which keeps replay deterministic and works when the plugin is no longer installed. If a replay wants to re-execute with live plugins, it must load the exact `id@version` and verify integrity, otherwise it refuses with a typed `PluginUnavailable`. Nondeterministic plugin tools are subject to the existing tool-effect ledger rules.
- **Honest claims**: if a plugin ran, receipts/summaries say so; nothing a plugin did is attributed to the framework.

## 9. Versioning, compatibility and the author kit

- **Plugin API version** is an integer (`engines.plugin`), bumped only on breaking changes to a contract; the framework supports the current and previous major. Extension points carry the stability labels from `reference/stability.md`; `experimental` points (strategies, providers) may break in minors, and the manifest must declare `engines["reactive-agents"]` with a tight range for them.
- Compat check runs at install, enable and agent build. Out-of-range = `disabled (incompatible)` with the reason, never a runtime surprise.
- **Contracts live in `@reactive-agents/plugin`** (types, `definePlugin`, `PluginManifest` schema, permission schema, conformance runners). Loader, lockfile and `withPlugin` live in `packages/runtime`. Cortex registries and UI live in `apps/cortex`.
- **Testing kit**: `@reactive-agents/testing` gains `testPluginContext()` (fake clock, in-memory secrets, recorded `fetch`, captured logs) and `runPlugin(plugin, scenario)` that builds an agent with the test provider and returns events, so a hook plugin is tested with a scripted run and zero tokens.
- **Conformance suites** (`runPluginConformance(plugin)`): manifest valid; `provides` matches what `setup` registers; permissions cover observed `ctx.fetch`/`ctx.secrets` use; hooks respect timeout and never throw out; no global mutation after `setup` scope closes (resources released); per-point suites reuse existing ones: `runAdapterConformance` for channels, judgment backend `capabilities` honesty check, strategy suite asserting no terminal status set outside `finalizeStrategyResult`, node suite validating schemas and `sideEffects` declaration.
- **Scaffold**: `bunx create-reactive-agent plugin <name> [--declarative]` generates manifest, `src/index.ts` using `definePlugin`, a test using the kit, a README template with the permission section, and CI that runs the conformance suite.
- **Docs**: `apps/docs` guide "Writing a plugin" and an extension-point reference page; `bun run repo scope` lists them as touched docs.

## 10. Hosted-ready seams (interfaces only, nothing built)

```ts
export interface PluginRegistry {                    // v1 impl: LocalRegistry (installed + first-party folder)
  readonly search: (q: string) => Effect.Effect<ReadonlyArray<PluginListing>, RegistryError>;
  readonly resolve: (id: string, range: string) => Effect.Effect<ResolvedPlugin, RegistryError>;   // -> source, integrity, manifest, signatures
}
export interface PluginPolicy {                      // v1 impl: allow-all-with-prompt
  readonly canInstall: (m: PluginManifest, src: PluginSourceInfo) => PolicyDecision;   // org allow/deny lists, required publisher verification
  readonly canEnable: (m: PluginManifest, workspaceId: string) => PolicyDecision;
}
export interface PluginMetering {                    // v1 impl: no-op; hooks for per-plugin usage (paid plugins, quotas)
  readonly record: (e: { pluginId: string; point: string; units: number }) => Effect.Effect<void>;
}
```
Per-workspace enablement is stored from day one (`plugin_enablement(workspaceId, pluginId, enabled)`; local-first has exactly one workspace). Manifest has an optional `publisher` and `license` for later entitlement checks. None of this blocks a marketplace; none of it is built.

## 11. Autotune as a first-party plugin (proof of the API)

**Idea:** a meta agent that diagnoses failing runs, proposes one change (config, skill or prompt), tests it, shows measured lift honestly, and applies only with approval.

**Deliverable as plugin `@reactive-agents/plugin-autotune`** (code tier, first-party), using only the public API:

| Autotune piece | Extension point used | Notes |
|---|---|---|
| "Diagnose this run" | Tool `autotune/diagnose` wrapping `rax-diagnose cause <runId>` / `attribute` (read-only over recorded traces) | Cortex's `run-cause.ts` already surfaces the cause; the tool exposes it to the meta agent. |
| Propose a change | Meta agent (a saved Cortex agent shipped in the plugin) produces a typed `Proposal {kind: "config"|"skill"|"prompt", diff, rationale}` | Output schema enforced; no free-text patches. |
| Test it | Tool `autotune/replay-eval`: replay past runs (`packages/replay`) with the candidate config + run saved eval cases (`packages/eval`) graded by judgment (`JudgmentService`, honoring `calibrated`) | Arms run through combinators: `parallel({baseline, candidate})` over a case set via `mapReduce`, each member a normal run with trace identity. |
| Show lift honestly | Slash command `/autotune report` + declarative panel (`table`, `chart`, `diff`) | Reports n, per-case results, effect size with interval, token cost of both arms, and an explicit "inconclusive" verdict when the bar (the project's lift rule: >=3pp at 95%, <=15% token overhead, enough runs) is not met. Cases are Bernoulli: small n is labeled noise. |
| Apply only with approval | `ChatEffect.Confirm` card via the existing proposal model (`chat-proposal-service.ts`); apply = write a Cortex agent config/skill revision, versioned | Never auto-applies; the meta agent can only propose (same rule as `/agent`). |
| Entry points | `/autotune <runId>` slash command (action), Run view button via a panel action | Uses Cortex's existing agentic chat controls, not new ones. |

Autotune needs from the platform: tool provenance, slash-command and panel registries, combinators, replay and eval access via tools, `Confirm` cards. If any of these is awkward to write, that is a defect in the plugin API, found before it ships. Autotune adds **no framework behavior**; it edits user config through approved proposals, which keeps it inside the "control and observability over magic" rule. Its lift claims are subject to the same honest-claims law as everything else, and the first release reports `inconclusive` rather than guessing.

## 12. Phased delivery and warden ownership

Contracts first, then loader, then one slice end to end, then breadth. Each slice is one concern per commit and goes to its owner via MissionBrief.

| Phase | Scope | Owner |
|---|---|---|
| P0 (prereqs, already planned) | Canonical `ChannelAdapter` + conformance (audit #5/#6); workflows Phase 0 | gateway-warden |
| **P1 (first slice)** | `@reactive-agents/plugin` contracts (`definePlugin`, manifest, permissions schemas); events `PluginLoaded/HookInvoked/HookFailed`; `withPlugin` expands hooks + tools + skills; lockfile + integrity; `tool.before/after` typed hooks; Cortex slash-command registry (data, replacing the closed union); `/plugin list|info|install|enable|disable` with confirmation card; Plugins Lab tab (list, detail, permissions, config form); `run-started.config.plugins`; Autotune "diagnose this failed run" skeleton | core (contracts/events), runtime (`withPlugin`, loader, lockfile), tools (`tool.before/after` seam), cortex (registry, UI, `/plugin`), harness (measurement/replay recording) |
| P2 | Declarative panels; themes; per-plugin kill switch + quarantine; update flow with permission diff; devtools tab; testing kit + `runPluginConformance`; `create-reactive-agent plugin` scaffold | cortex, runtime, core, testing kit under runtime |
| P3 | Combinators in `packages/compose` (`Member`, sequence/parallel/race/fallback first; router, verify, supervisor, mapReduce next); `toWorkflow(combinator)`; `asTool` | compose-warden (+ eval-warden for `router` judgment contract) |
| P4 | Judgment backend and workflow-node extension points; channel adapter plugins (after P0); Autotune full loop (replay-eval, report panel, apply with approval) | eval-warden, runtime-warden (workflows package), gateway-warden, cortex |
| P5 | Strategy and provider extension points (experimental), plus `PluginRegistry`/`PluginPolicy` interface stubs | kernel-warden (typed rails only; no terminal logic), provider-warden |
| P6 | Isolation spike (subprocess runtime) only if a real untrusted-plugin use case appears | runtime + harness |

Cross-cutting: ablation-warden is not needed for plugins (they are opt-in per agent and add no default-on harness mechanism). harness-warden measures hook overhead (see acceptance test 6) and Autotune's lift claims. release-warden gates the new package into the lockstep release and `check-version-sync`.

### First slice: named acceptance tests (zero-token, scripted provider)
0. **Spike first** (`phase-hook-liveness.test.ts`): for each of the 12 phases x 3 timings, assert the hook fires in a scripted run. The 2026-07-05 audit said 8/12 never fired; whatever does not fire today is excluded from the plugin contract or fixed by its owner before P1 proceeds.
1. `plugin-manifest.test.ts`: valid manifest decodes; missing `engines` or an unknown permission key is rejected with a located error.
2. `with-plugin-expands.test.ts`: a plugin providing a hook + a tool + a skill yields an agent whose registries contain exactly those, each tagged with `pluginId`; the equivalent hand-written builder calls produce an identical `run-started.config` apart from the `plugins[]` block.
3. `plugin-conflict.test.ts`: two plugins registering the same tool name fail `build()` with `PluginConflictError` naming both ids.
4. `tool-before-deny.test.ts`: a `tool.before` plugin returning `Deny` produces a normal traced tool error, the model sees it, the run continues, and `PluginHookInvoked{decision:"Deny"}` is emitted; a `Rewrite` is re-validated against the tool schema.
5. `plugin-failure-isolation.test.ts`: a throwing/timeouts hook emits `PluginHookFailed`, the run completes, and after N failures the plugin is `quarantined`; a `critical` hook fails closed.
6. `plugin-hook-overhead.test.ts`: with the test provider, a no-op plugin adds under a fixed budget (e.g. 2 ms per hook call) and zero LLM tokens.
7. `lockfile-integrity.test.ts`: tampering with an installed plugin file flips it to `quarantined` at next load; an `npm` install path never runs lifecycle scripts.
8. `replay-with-plugin.test.ts`: a recorded run with a rewriting plugin replays to the same result with the plugin uninstalled (decisions replayed from events); live re-execution without the exact `id@version` returns `PluginUnavailable`.
9. `slash-registry.test.ts` (cortex): built-in and plugin commands share one registry; a collision is reported at enable time; `kind:"prompt"` expands the template; action handlers run server-side.
10. `plugin-install-card.test.ts` (cortex): `/plugin install <local path>` renders the confirmation card with the permission checklist and does nothing until confirmed; an agent-proposed install requires the same approval.
11. `autotune-diagnose.test.ts`: `/autotune <runId>` on a recorded failing run calls `autotune/diagnose`, returns the same cause `rax-diagnose cause` returns, and applies nothing.

Done criterion for P1: all eleven green, `bun run repo verify` on each touched package, `bun run repo check --all`, docs page "Writing a plugin" for hook + tool + slash command, changeset.

## 13. Open questions, risks, and what to cut first

### Owner questions
1. **Package home.** New `@reactive-agents/plugin` (contracts only, deps: core) owned by runtime-warden, versus putting contracts in `core`. Recommendation: new package; core stays small and plugin API versions independently. Needs owner approval (new package).
2. **Naming**: "plugin" everywhere (framework + Cortex) vs "extension" for Cortex-only parts. Recommendation: one word, "plugin".
3. **First-party plugins in-repo or separate repo?** Recommendation: in-repo `plugins/` folder to dogfood and test against the API; split later.
4. **Is `tool.before` `Rewrite` acceptable in v1?** It is the most powerful (and risky) hook. Alternative: v1 ships `Continue|Deny` only; rewrite arrives with evidence of need.
5. **Declarative panels vs iframe** (decided: declarative; confirm).
6. **Autotune scope for first release**: ship diagnose-only skeleton (P1) and the full loop later (P4), or hold until the full loop works? Recommendation: skeleton in P1 as the API proof, full loop later.

### Authority-doc amendments this spec requires (do not drift silently)
- **A1 (09 / Plan 9):** Plan 9 defers plugin packaging, versioning and sandboxing until after Phase 4. This spec proposes building the *packaging and trust layer* and the already-converged extension points (tools, skills, hooks, judgment, slash commands) before Phase 4, and holding strategy, kernel-operation, guidance, dialect and tier-profile points until their phases land. Amend Plan 9's "Extension points" section to say so, or hold P1 until Phase 4.
- **A2 (09 C5):** combinators in `packages/compose` are multi-agent topology work, which C5 gates behind RunAssessment (WIP=1). Either amend C5 to authorize `Member` combinators (justified by workflows and Autotune as consumers) or defer P3 until RunAssessment ships.
- **A3 (08 Arc 4):** the manifest `claims` block and "quality claim requires a replayable receipt" implement Arc 4's harness packages; record this as the first concrete step.
- **A4 (Decision Index):** "Multi-Agent Orchestration & Teamwork" is listed DEFERRED/Spec 16; update when A2 is decided.
- **Q7 (owner):** keep both combinator surfaces (harness-transform delegation policy and `Member` programs) as proposed in section 0?

### Risks (stated plainly)
- **Trust theater.** A permission list can look like a sandbox. Mitigation: the "Trusted code" label and the unenforced-permissions sentence are mandatory UI copy; test the copy exists.
- **Surface growth.** Twelve extension points is a lot to keep stable. Mitigation: ship P1 with hooks/tools/skills/slash only; every other point waits for a first-party plugin that needs it.
- **Hook semantics creep.** `Rewrite` and `Propose` interact with guardrails and the terminal path. Mitigation: typed results only, conformance suite, kernel-warden review for anything touching rails, ordering = declaration order and documented.
- **Dependency on unfinished work.** Channel plugins need audit #5/#6; workflow-node plugins need the workflows package; combinators need compose-warden capacity. The plan sequences around these; P1 depends on none of them.
- **Cortex registry refactor** (closed unions to data) touches frozen giants (UI modernization is splitting them). Coordinate with the active UI modernization plan so the slash-command registry lands once.
- **Config/secret handling bugs** are the likeliest real-world leak. Secrets are references and `Redacted` end to end; add a test that no secret value appears in events, traces, logs or `run-started.config`.
- **Replay fidelity** for plugin tools with side effects relies on the effect-ledger model from the workflows spec; if that slips, P1 replays decisions only.
- **Combinator overlap with workflows** may produce two orchestration models. Mitigation: the single `Member` contract and the one-way lowering rule (5.4); revisit if the workflow walker needs combinators to diverge.
- **Ecosystem cold start.** Free and open source with no registry means discovery is manual. Acceptable for now; first-party plugins are the seed.

### What to cut first (in order)
1. Provider and strategy extension points (P5).
2. Themes and the reserved `frame` panel.
3. `debate`, `supervisor` and `mapReduce` combinators (keep `sequence`, `parallel`, `fallback`, `router`, `verify`).
4. Update flow polish (manual reinstall suffices at first).
5. `llm.before/after` and `approval` hooks (keep `tool.before/after`, `output`).
6. Never cut: manifest + lockfile + integrity, no-postinstall, permission review card, `pluginId` on events, `run-started.config.plugins`, kill switch. Those are the trust floor.
