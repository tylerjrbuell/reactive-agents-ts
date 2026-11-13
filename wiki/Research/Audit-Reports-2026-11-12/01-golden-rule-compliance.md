---
type: audit
status: draft
created: 2026-11-12
tags: [audit, golden-rules, coding-standards, effect-ts, compliance]
---

# 01 - Golden-rule and CODING_STANDARDS compliance audit (2026-11-12)

Read-only. Scope: `packages/*/src` + `apps/cortex/server`, tests/dist excluded (1267 .ts files).
Method: a regex scan over `git ls-files` (comment lines skipped; scratch script, not committed) for stock counts; `git log --since="2026-11-12 00:00" -p` (83 commits) for lines ADDED today; gate scripts run for ledger state.
Caveat: regex counts, not AST. `throw` / `await` / `interface` / `process.env` counts over-approximate (some sit in legitimate sync/edge code); each section says how much.

## 0. Ledger state (what is already tolerated)

| Gate | Output today | Covers |
|---|---|---|
| `scripts/check-string-errors.sh` | PASS: 246 `new Error(` (baseline 246), 120 `instanceof *Error` (baseline 120) | `packages/**/src` incl. test-in-src files; NOT `apps/cortex/server` |
| `scripts/check-type-escape-hatches.sh` | PASS. Baseline reasoning 30, runtime 28, testing 4, RI 3, benchmarks 2, tools 1 | `packages/*/src` only; greps `*.test.ts` inside src too |
| `scripts/check-cast-ceilings.sh` -> `packages/runtime/test/as-unknown-as-ceiling.test.ts` | ceiling test (not re-run here) | `as unknown as` repo-wide |
| `packages/observability/tests/console-ceiling.test.ts` | exists | console.* |
| `scripts/check-file-size.sh` | PASS, 25 baselined giants | file size |

Ledger blind spot (finding L1): **`apps/cortex/server` is outside the string-error, escape-hatch and `instanceof` ratchets.** It holds 37 throws, 29 `new Error(`, 7 `as any`, 37 `instanceof *Error` and 26 `process.env` reads, and absorbed all of today's growth in these categories (section 1).
Also: the escape-hatch baselines for reasoning (30) and runtime (28) are mostly test-in-src files. My non-test scan finds 0 `as any` in reasoning src and 6 in runtime src, so those baselines hide ~24 slack in reasoning (a ratchet with slack lets new production `as any` in without tripping). `--tighten` prints the same numbers, so the gate's own count is consistent; the point is that it does not separate prod from test.

## 1. Summary table (non-test src, stock vs added today)

| Category | Stock | Added today (non-test src lines) | Ledgered? |
|---|---|---|---|
| `throw` | 217 (framework pkgs ex-benchmarks/testing/diagnose/ui: 122; cortex 37) | 21 (9 + 1 runtime-shim PublicUrlError, 6 runtime, 3 cortex, 1 tools, 1 gateway) | partly (string-throws only, packages only) |
| `new Error(` | 199 | 12 (9 cortex, 1 gateway, 1 tools, 1 other) | packages yes, cortex no |
| raw `await` | 929 (framework ex-edge pkgs 454; cortex 316) | 207, of which ~190 cortex | no |
| `new Promise` / `Promise.all/race` / async fn | 623 | 13 | no |
| `as any` / `: any` | 18 | 0 | packages yes (loosely), cortex no |
| `as unknown as` | 48 | 1 (`runtime-shim/src/pinned-fetch.ts`) | yes, ceiling test |
| `@ts-ignore` / `@ts-expect-error` | 0 | 0 | clean |
| `interface` | 1525 declarations vs 140 `Schema.Struct(` | 106 | no |
| `instanceof *Error` | 121 | 7 (all cortex) | packages yes |
| `console.*` | 151 (fw excl. CLIs/bench ~45) | 1 (`cortex/server/api/mcp-servers.ts`) | observability only |
| Bun-specific (`Bun.` / `bun:`) | 60 (cortex 48) | 9 (all cortex `import type { Database } from "bun:sqlite"`) | no |
| `process.env` | 93 | 10 (5 cortex index.ts, 5 packages) | no |
| module `let` | 16 | 0 | no |
| module `new Map/Set/WeakMap` const | 159 (mostly read-only constants) | 21 | `check-run-scope.sh` covers run state |
| exports without JSDoc | 1420 of 5078 top-level exports (28%) | not measured | no |
| exported string-literal unions | 170 | not measured | no |

Headline: today's package-level work was clean (0 `as any`, 1 cast, string-errors ledger shrank 255 -> 246). Today's new violations are concentrated in **apps/cortex/server** (channel-hub family: `channel-hub*.ts`, `gateway-channel-host.ts`, `speech-supervisor.ts`, `chat-detached-run.ts`), which sits outside most ledgers.

## 2. Category detail

### 2.1 `throw` in Effect code
Stock 217. Triage: most framework throws are NOT in `Effect.gen` bodies. Sync builder-API validation (`runtime/src/builder/withers/tools.ts:168-190`, `model-budget.ts:83`, `build-agent.ts:272-284`) is the public sync surface and throws typed errors; parser throws inside `Effect.try` (`reasoning/src/kernel/utils/tool-parsing.ts`, 7 `ToolExpressionParseError`; `kernel-codec.ts:221-242`, 4 `KernelCodecError`) are typed and caught at the boundary. Genuinely untyped, inside async tool handlers: below.
Worst 10 (file:symbol, count):
1. `apps/cortex/server/services/chat-session-service.ts` ChatSessionService methods (`validateTodo`, `approvableAgentFor`, `fork`, `editSummary`...) - 19 throws, 16 `new Error(string)`. Rejects to HTTP layer. [grandfathered? no: cortex outside ledger, file touched today]
2. `packages/tools/src/mcp/mcp-client.ts` `connect*`/transport selection (lines 121-1055) - 17 [string-error ledger]
3. `packages/benchmarks/src/tau-bench/loader.ts` - 13 (19 `new Error`) [ledger]
4. `packages/tools/src/skills/file-operations.ts` - 10 [ledger; touched today, +1 `throw new Error(secret...)` line 78ab041b4]
5. `packages/tools/src/skills/web-search.ts` - 9 (`throw formatWebSearchFailure(...)` added today, cbc9a5414)
6. `packages/testing/src/helpers/assertions.ts` - 8 (assertion helpers; acceptable)
7. `packages/reasoning/src/kernel/utils/tool-parsing.ts` - 7 typed, fine
8. `packages/tools/src/adapters/http-tool-adapter.ts` - 6
9. `apps/cortex/server/services/chat-detached-run.ts` - 5 (3 new `new Error(string)` today, 423dbba16)
10. `packages/runtime-shim/src/assert-public-url.ts` - 9 added today (5c1448ced), typed `PublicUrlError`, sync guard: OK but see 2.2.
NEW today: `channel-hub-resolver.ts` (2 string throws), `channel-adapters.ts` (2), `channel-hub.ts:~` (`throw new Error(describeFailure(exit.cause))`), `chat-detached-run.ts` (3), `index.ts` (`throw new Error(refusal)`), `gateway/src/adapters/github-adapter.ts` (`throw new Error("replayed delivery ...")`), `tools/skills/file-operations.ts` (1).
Fix pattern: `Data.TaggedError` + `Effect.fail`; exemplar `packages/trace/src/` `RationaleValidationError`/`TraceStorageError` (D3 tranche 1) and `packages/diagnose` `DiagnoseUsageError`; for async class services, `ChatSessionBusyError` (already typed in chat-session-service.ts:369). Owner: tools-warden (tools), cortex-warden (cortex), gateway-warden, harness-warden (benchmarks/testing).

### 2.2 Raw `await` / Promise outside runtime-shim and edge adapters
Stock: 929 `await`, 623 Promise-ish. Excluding apps/cortex, benchmarks, diagnose, CLI scaffolds, testing, UI bindings: 454 `await` in framework packages. Many are legitimate edge code (HTTP handlers, process spawn, SDK adapters), but these are NOT shim/adapters:
1. `packages/tools/src/mcp/mcp-client.ts` - 27
2. `packages/runtime/src/server/endpoints.ts` - 25 (HTTP edge: acceptable)
3. `packages/runtime/src/chat/engine.ts` - 20
4. `packages/tools/src/skills/file-operations.ts` - 19
5. `packages/runtime/src/agent/gateway-inbound-queue.ts` - 18
6. `packages/tools/src/skills/web-search.ts` - 16
7. `packages/runtime/src/builder/build/build-agent.ts` - 15 (async facade `build()`, public Promise API)
8. `packages/llm-provider/src/providers/local.ts` - 14
9. `packages/tools/src/mcp/auth/{authorization-code-provider,token-store}.ts` - 14 each (MCP SDK interface requires Promise; acceptable adapter)
10. `packages/runtime/src/agent/gateway-runner.ts` - 13, `gateway-tick.ts` - 10
Cortex: 316 `await` (chat-session-service 37, speech-supervisor 26, api/chat.ts 18, api/runs.ts 18). Cortex is a class-and-Promise Bun/Elysia app; AGENTS.md rule 2 is written for framework Effect code. Decision needed (finding D1): either declare Cortex server exempt (amend CODING_STANDARDS, add a ledger) or migrate. I recommend exempt + ledger, not migration.
NEW today: ~207 added `await` lines, ~190 in Cortex (`speech-supervisor.ts` 26, `gateway-channel-host.ts` 24, `channel-hub.ts` 14, `channel-hub-resolver.ts` 13); `runtime-shim/src/pinned-fetch.ts` new `new Promise<Response>` (shim: allowed); `gateway/src/ingress/ingress-server.ts` `Promise.race([reader.read(), aborted])` (HTTP edge).
Fix pattern: `Effect.tryPromise({ try, catch })` at the seam; exemplar for edge code that stays Promise: `packages/runtime-shim`. Owner: tools-warden / runtime-warden / cortex-warden.

### 2.3 `any` / `as any` / `as unknown as`
- `as any` / `: any`: 18 sites, 0 added today. All ranked: `apps/cortex/server/api/agents.ts:69,110` (`body as any`), `runner-service.ts:452,649`, `gateway-process-manager.ts:457`, `tool-playground-invoke.ts:135`, `db/queries.ts:673` (`prepare(...) as any`); `runtime/src/agent/gateway-runner.ts:59,92` (`execute: (task: any) => Effect<any, any>` - interface type holes, worst: prod type surface), `skills-facade.ts:164`, `parent-context.ts:78`, `chat-manager-factory.ts:97`, `build/build-effect.ts:199` (`(PromptService as any).pipe`); testing mocks (4, allowed by policy). Ledger: 28 for runtime is test-in-src slack; 7 in cortex are un-ledgered.
- `as unknown as`: 48 (reasoning 18, runtime 18, cortex 6). Worst: `reasoning/src/kernel/utils/service-utils.ts:183,193,218` (3x `serviceOption` casts - candidate for one typed helper), `structured-output/grounded/grounded-extract.ts:115,131,178`, `runtime/src/builder/build-effect/sub-agent-executor.ts:320,326,594`, `cortex/server/services/ingest-service.ts:45,114,224,260` (4x `event as unknown as Record<string, unknown>` - same cast repeated, boundary fix), `reasoning/src/strategies/code-action.ts:166,653`, `engine/finalize/run-finalize.ts:149`. Added today: 1 (`pinned-fetch.ts` Readable.toWeb cast, Node typing gap).
Fix pattern: single typed helper per repeated cast (AGENTS.md "boundary first"); exemplar: CODING_STANDARDS "more than 2 casts -> typed helper"; for events, `packages/runtime/test/as-unknown-as-ceiling.test.ts` notes "design it out" precedent. Owners: kernel-warden (reasoning), runtime-warden, cortex-warden.

### 2.4 Plain `interface` vs `Schema.Struct`
1525 `interface` declarations vs 140 `Schema.Struct(` calls. The convention is observed in the breach: CODING_STANDARDS says Schema.Struct for all data shapes, with one exception (strategy inputs). Per-package: reasoning 458, runtime 259, cortex 197, ui-core 163, tools 129. Worst files: `ui-core/src/protocol/events.ts` (40), `runtime/src/builder/types.ts` (21), `reasoning/src/kernel/ledger/run-ledger.ts` (13), `runtime/src/services/run-store.ts` (13), `cortex/server/services/run-compare.ts` (12), `core/src/types/checklist.ts` (12). Added today: 106 (channels/routing 9+4, cortex channel-hub family ~30).
Assessment: most of these are internal function-parameter or readonly runtime shapes that never cross a serialization boundary; mass conversion is not worth it and AGENTS.md simplicity principle argues against it. Recommend amending the standard to "Schema.Struct for shapes that are persisted, decoded, or cross a package/wire boundary; `interface` OK for internal readonly contracts", then converting only wire shapes. Needs design decision, not mechanical. Exemplar: `packages/core/src/types/` Schema usage.

### 2.5 Untagged errors crossing boundaries / `instanceof`
`new Error(` 199; `instanceof *Error` 121 (ledger 120 in packages). Boundary-crossing untagged: mcp-client (16), cortex chat-session-service (16), file-operations (10), web-search (8), `runtime/src/agent/judgment-facade.ts` (6), `runtime/src/builder/build-effect/remote-agent-tools.ts` (6). `instanceof` worst: `tools/src/mcp/mcp-client.ts` 9, `cortex/server/api/chat.ts` 8, `judgment/src/backends/jev-backend.ts` 7, `reasoning/.../act/tool-execution.ts` 4, `iterate-run-ctl-checkpoint.ts` 4. Added today: 7 cortex `e instanceof Error ? e.message` sites.
Copied logic: the idiom `x instanceof Error ? x.message : String(x)` occurs ~88 times in 61 files (regex), while 6 files define their own message helper (`cortex/.../chat-approvals.ts`, `ingest-service.ts`, `provider-key-store.ts`, `runtime/src/goal/pursue.ts`, `tools/src/execution/sandbox-lifecycle.ts`, `ui-core/src/state/turn-outcome.ts`). This violates "canonical per failure class": one `errorMessage(unknown)` in `@reactive-agents/core` (check first for an existing one; `core/src/services/error-swallowed.ts` has `errorTag`) would let the `instanceof` ledger shrink. Owner: core-warden (helper) then per-package wardens. Mechanical after the helper exists.

### 2.6 Missing JSDoc on public exports
1420 of 5078 top-level `export` declarations (28%) have no preceding `*/`. NOTE: counts per-file exports, not only barrel-reachable ones, so it over-states public gaps. Worst packages: reasoning 334/1725, runtime 167/843, core 143/360, tools 122/519, `interaction` 86/89 (97%), benchmarks 69/162, reactive-intelligence 61/140, memory 48/63, `prompts` 48/48 (100%), eval 42/111. `interaction` and `prompts` are near-total gaps (`interaction/src/errors/errors.ts` all 4+ errors, `a2a/src/client/a2a-client.ts` `A2AClient`, `ClientConfig`, `createA2AClient`). No gate exists. Fix: add JSDoc to barrel (`index.ts`) reachable exports first. Mechanical but needs a human-quality sentence each; safe for any warden. Exemplar: any `core/src/services/*.ts` service with `/** */` on Tag + methods.

### 2.7 Hidden module-level mutable state
Module `let` (16): `tools/src/mcp/mcp-client.ts:78` (`defaultTokenStore`), `:235` (`exitHandlerRegistered`); `memory/src/extraction/memory-extractor.ts:64` (`idCounter`); `reasoning/src/strategies/code-action/sandbox-worker.ts:39` (worker-thread local, fine); `runtime/src/capability/manifest.ts:26` (cache); `testing/src/gate/registry.ts:20` (cache); `tools/src/skills/crypto-price.ts:9` (`retryBaseMs`, test seam); cortex `ollama-cloud.ts:96,98` (installed store + `envBefore` capturing process.env - mutable global), `provider-key-store.ts:463`, `cortex-version.ts:138`, `ws/ingest.ts:6` (`parseErrorCount`), `chat-session-service.ts:802`. Module-level Map/Set constants: 159 (most read-only tables; `gateway-runner.ts` 3 added today - check mutability). Run-scope guard `check-run-scope.sh` exists. Worst real risk: `mcp-client.ts` `exitHandlerRegistered`/`defaultTokenStore` (process-wide, survives across agents) and `memory-extractor.ts:64` `idCounter`. Fix pattern: `Ref`/service state; exemplar `packages/core/src/internal/run-scope.ts` (FiberRef per run). Owner: tools-warden, memory-warden. Needs design (S each, but test-seam ones should stay).

### 2.8 `console.*` instead of events/tracer
Framework (excl. CLIs, benchmarks): ~45 sites. Legit (renderers, ledgered by `console-ceiling.test.ts`): `observability/exporters/console-exporter.ts` 6+, `logging/*`. Questionable: `runtime/src/engine/finalize/run-finalize.ts:276-284` (Run Summary printing), `runtime/src/builder/{api-surface,wither-applies,build/build-agent,build/build-effect,build-effect/pricing-fetch}.ts` (warn), `reasoning/.../reason/think.ts:407` (`[RA_ASSEMBLY_TRACE]` console.error debug), `reasoning/state/kernel-codec.ts:59`, `reactive-intelligence/skills/skill-registry.ts:95,113`, `skill-resolver.ts:174`, `tools/src/mcp/mcp-client.ts:45,739`, `llm-provider/{thinking/resolve.ts:47, providers/chat-tools-rules.ts:31}`, `runtime/src/agent/gateway-runner.ts:375`. Cortex: `api/mcp-servers.ts:106-146` (4, 1 added today) and `services/mcp-discovery.ts:12,43` bypass `cortexLog` (which the channel-hub code uses). Fix: Cortex -> `cortexLog`; framework warnings -> `ObservableLogger`/EventBus event. Exemplar: `cortex/server/services/channel-hub.ts` uses `cortexLog("warn", "channels", ...)`. Owner: cortex-warden (S, mechanical); runtime-warden/kernel-warden for rest (M, needs event choice).

### 2.9 Bun-specific APIs outside allowed files
Runtime Policy allows `bun:sqlite`/`Bun.serve`/`Bun.spawn` only in files already using them. Count 60: cortex 48 (all `import type { Database } from "bun:sqlite"`, type-only, 9 new files today), benchmarks 8 (`h3/long-horizon-tasks.ts` 6), eval 2 (`services/eval-store.ts:41` lazy `require("bun:sqlite")` - documented), tools 2. Verdict: Cortex is a Bun app (`apps/cortex/AGENTS.md`), type-only imports are low risk; but Cortex could import the type from `@reactive-agents/runtime-shim` `Database` and stop growing the Bun surface. S, mechanical. Owner: cortex-warden.

### 2.10 `process.env` reads in services
93 sites. Config-time reads in builders are expected, but these are inside services/runtime paths and bypass config: `reasoning/src/kernel/loop/runner.ts:179` (`REACTIVE_AGENTS_FORCE_TEXT_PARSE`), `strategies/reactive.ts:348` (`REACTIVE_AGENTS_NOOP_VERIFIER`), `kernel/loop/runner-terminal-verify-gate.ts:83` (`DEBUG_VERIFIER`), `kernel/assessment/guard-adapters.ts:45`, `evidence-grounding.ts:116`, `utils/text-parse-mode.ts:39`; `runtime/src/engine/execute-completion-obs.ts:78`, `finalize/telemetry-emit.ts:291`, `phases/agent-loop/setup/calibration.ts:37` (three copies of `REACTIVE_AGENTS_OBSERVATIONS_DIR`), `builder/helpers.ts:57,385`; `reactive-intelligence/src/telemetry/telemetry-client.ts:14-33` and `calibration/community-profile-client.ts:26-28` (duplicate base-URL env resolution); `llm-provider/providers/litellm.ts:276,281`; `a2a/server/http-server.ts:259-260`. Several already pass `env` as an injectable default param (`execute-run-config.ts:58 readRaEnv`, `think-guards.ts:633`, `context-engine.ts:44`) - that is the exemplar to copy. Cortex: 26, 5 added today in `index.ts` (token, bind refusal, guard config). Copied-logic: `REACTIVE_AGENTS_OBSERVATIONS_DIR` x3 should be one config resolver in `execute-run-config.ts`. Owners: kernel-warden, runtime-warden. M, design for env-flag removal (many are debug seams).

### 2.11 Stringly-typed unions
170 exported `type X = "a" | "b"` unions (e.g. `reasoning/src/kernel/policy/harness-plan.ts` 5, `core/src/types/skill.ts` 4, `gateway/src/schedule/types.ts` 4, `reasoning/.../run-contract.ts` 4, `channels/src/routing/types.ts` 3). TS literal unions are the repo's pervasive style for internal types; the standard asks `Schema.Literal` only for schema-backed shapes. Low value to convert; flag only where a union is also decoded from the wire/DB (`cortex` channel config, gateway schedule types). Needs design.

### 2.12 Copied logic vs 'canonical per failure class'
- error-to-message idiom ~88x (2.5).
- `ingest-service.ts` 4x identical `as unknown as Record<string, unknown>` event cast (one typed accessor).
- Env `REACTIVE_AGENTS_OBSERVATIONS_DIR` resolved in 3 places; `REACTIVE_AGENTS_TELEMETRY_BASE_URL` in 2.
- `session-capabilities.ts` (cortex, added today) defines ON/OFF/ASK/AUTO word-sets; check against existing approval-policy parsing in `cortex/server/services/approval-policy.ts` before accepting.

## 3. Prioritised fix plan by warden

Sizing: S <1h, M half-day, L multi-day. "Mech" = safe to do mechanically; "Design" = needs a decision first.

**cortex-warden** (owns 80% of today's new violations)
1. S, Design: decide Cortex server policy (exempt from Effect-only rules vs typed errors). Then add a Cortex ledger so it stops being a ledger blind spot: extend `check-string-errors.sh` and `check-type-escape-hatches.sh` to scan `apps/cortex/server`, baselined at today's counts (37 throws, 29 `new Error`, 7 `as any`, 37 instanceof).
2. S, Mech: remove 7 `as any` (`api/agents.ts:69,110` -> decode body with Schema; `runner-service.ts:452,649`; `gateway-process-manager.ts:457`; `tool-playground-invoke.ts:135`; `db/queries.ts:673`).
3. S, Mech: today's 9 new `new Error(string)` in `channel-hub*.ts`, `channel-adapters.ts`, `chat-detached-run.ts`, `index.ts` -> tagged errors (exemplar `ChatSessionBusyError`).
4. S, Mech: `console.*` in `api/mcp-servers.ts`, `services/mcp-discovery.ts` -> `cortexLog`.
5. S, Mech: `ingest-service.ts` 4 repeated casts -> one typed accessor.
6. M, Mech: `chat-session-service.ts` 16 string throws -> typed errors.
7. S, Mech: `bun:sqlite` type imports -> runtime-shim `Database` type (stops the 9-new-files growth).

**core-warden**
1. S, Design: add a canonical `errorMessage(u: unknown): string` to `@reactive-agents/core` (check `error-swallowed.ts` first); then wardens replace ~88 copies (M total, Mech) and the instanceof ledger drops.
2. S, Mech: `core/src/services/harness-pipeline.ts:118` cast.

**tools-warden**
1. M, Mech: `mcp-client.ts` 16 string throws -> `McpConnectionError` family; `file-operations.ts` 10, `web-search.ts` 8 (one new today), `http-tool-adapter.ts` 6.
2. S, Design: `mcp-client.ts:78,235` module-level state -> per-client/Ref.
3. M, Design: `mcp-client.ts` + `file-operations.ts` `await` -> `Effect.tryPromise` at handler seams (keep SDK-required Promise adapters).

**runtime-warden**
1. S, Mech: remove `any` in `agent/gateway-runner.ts:59,92`, `skills-facade.ts:164`, `parent-context.ts:78`, `build-effect.ts:199`, `chat-manager-factory.ts:97`.
2. M, Mech: dedupe three `REACTIVE_AGENTS_OBSERVATIONS_DIR` reads into `execute-run-config.ts`.
3. M, Design: console warn sites in builder (`api-surface`, `wither-applies`, `pricing-fetch`, `build-agent`, `build-effect`) -> logger/event.
4. M, Mech: JSDoc the `runtime` barrel exports (167 gaps; fewer reachable).
5. L, Design: 18 `as unknown as` (sub-agent-executor, runtime-construction, run-finalize) via typed adapters; ceiling test already guards regrowth.

**kernel-warden** (also RI)
1. S, Mech: `service-utils.ts:183,193,218` + `code-action.ts:166` -> one typed `serviceOptionOf<T>` helper (4 casts).
2. M, Design: debug env flags (`DEBUG_VERIFIER`, `REACTIVE_AGENTS_NOOP_VERIFIER`, `RA_FABRICATION...`, `FORCE_TEXT_PARSE`) -> `.withHarness()` config or `readRaEnv`.
3. S, Mech: `think.ts:407` console.error trace -> event/tracer.
4. M, Mech: RI telemetry env duplication (`telemetry-client.ts`, `community-profile-client.ts`) -> one resolver.
5. M, Mech: JSDoc reasoning barrel exports (334 gaps; gate out of scope).

**gateway-warden**
1. S, Mech: `github-adapter.ts` `throw new Error("replayed delivery")` -> tagged error (new today); `a2a/http-server.ts:259` env read -> config.
2. S, Mech: JSDoc `a2a/src/client/a2a-client.ts` exports.

**eval-warden / memory-warden**
- memory: `memory-extractor.ts:64` `idCounter` -> Ref or `crypto.randomUUID`; JSDoc 48 gaps (S/M Mech).
- eval: JSDoc 42 gaps; `eval-store.ts` bun:sqlite documented (leave).

**harness-warden** (benchmarks/testing/diagnose)
- Low priority: `benchmarks/tau-bench/loader.ts` 13 throws, testing mocks' `as any` (policy-allowed). Leave grandfathered; note `testing/src/gate/registry.ts:20` cache.

**Repo/standards (parent, not a warden; needs owner decision)**
1. Design: amend CODING_STANDARDS: (a) Schema.Struct only for wire/persisted shapes, interfaces OK internally (1525 vs 140 shows the rule is already unenforced), (b) Cortex server and edge adapters exempt from Effect-only. Amend rather than drift silently (AGENTS.md authority rule).
2. S, Mech: make `check-type-escape-hatches.sh` skip `*.test.ts` and re-baseline (reasoning 30 -> ~0) so the ratchet becomes real.
3. M: add a JSDoc ratchet for barrel-reachable exports of `interaction` and `prompts` (both ~100% missing).

## 4. What I did not verify
- Whether each `throw` sits inside an Effect context (regex only; spot-checked reasoning/runtime lists above).
- Barrel reachability of un-JSDoc'd exports.
- Mutability of the 159 module-level Map/Set constants (counts only).
- Ownership beyond `bun run repo scope` for a 14-file sample (owners: core, cortex, eval, gateway, harness, kernel, memory, runtime, tools; `create-reactive-agent` has no owner).
- `as-unknown-as` ceiling test was not re-run.
