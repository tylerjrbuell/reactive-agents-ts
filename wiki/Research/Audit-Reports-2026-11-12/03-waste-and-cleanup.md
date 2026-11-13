---
type: audit
status: draft
created: 2026-11-12
tags: [audit, cleanup, dead-code, disk, docs-drift, changesets]
---

# 03 - Waste and cleanup audit (read-only)

Scope: dead code, duplicates, stale files, oversized files, disk, docs drift. Nothing deleted or edited. Method: `bun run repo check --all` (35 pass / 0 fail, so no ratchet gate is red), `scripts/check-file-size.sh`, `scripts/check-orphans.sh`, `git ls-files`, a repo-wide identifier-frequency pass (4,451 tracked TS/Svelte files; 7,483 non-test `export` names; names occurring exactly once repo-wide), `/usr/bin/grep -a`. No knip/ts-prune is configured in package.json or tools/repo (nothing installed). Owners via `bun run repo scope` / ownership.json roster (not run per-file; owner given by package).

Caveat: frequency pass only sees exact-name text. Dynamic/string refs and `export *` public surface are not proven absent. Hence the three-tier split below.

## 1. Dead code

37 exported names occur exactly once in the repo (definition only).

### 1a. Cortex (an app, not a library: no public-API exemption) - sole-caller proven
Exact-name search over apps, packages, scripts, wiki finds only the definition (two hits only in an archived 2026-03-31 plan). Owner: cortex-warden.

| Symbol | File |
|---|---|
| `listCachedToolsForServer` | apps/cortex/server/db/mcp-queries.ts |
| `getRunDebrief` | apps/cortex/server/db/queries.ts |
| `CortexErrors` | apps/cortex/server/errors.ts |
| `configToolNames` | apps/cortex/server/services/channel-hub-migration.ts |
| `installedOllamaEndpointStore` | apps/cortex/server/services/ollama-cloud.ts |
| `AgentSummary` | apps/cortex/server/types.ts |

Impact: small (tens of LOC). Safe-to-delete after one more `bun run repo verify apps/cortex`; the `export` keyword may also be removable instead of the body where the symbol is used locally.

### 1b. Framework, not re-exported from the package index - needs sole-caller proof (owner by package)
Name appears once; not in the package `index.ts` (llm-provider/reasoning/runtime/RI index uses named exports, checked runtime + RI):
- `mergeReasoningConfigForRuntime` (packages/runtime/src/synthesis-resolve.ts:50; the index exports only the sibling `resolveSynthesisConfigForStrategy`) - runtime-warden
- `computeEntropyStats` (packages/reactive-intelligence/src/measurement.ts) - kernel-warden
- `TEXT_ONLY_RULES` (llm-provider/src/content-parts.ts), `_resetTokenizerFactorsCacheForTesting` (tokenizer-factors.ts, no test uses it) - provider-warden
- `ProtectedClass` (reasoning/assembly/compaction.ts), `ToolsSnapshot` (assembly/types.ts), `KernelRecallConfig` (types/kernel-meta-tools.ts) - kernel-warden (types; may be reached via `export type *`, verify)
- `HarnessConfigEncoded` (runtime/harness-schema.ts), `JudgeContextOptions` (runtime/judgment-context.ts), `ChannelSession` (runtime/agent/gateway-bootstrap.ts) - runtime-warden
- `DELIVERY_KINDS_MATCH` (channels/services/gateway-bridge.ts), `ActiveSession` (channels/types.ts; channels index has 16 `export *`, so likely public) - gateway-warden
- `PolicyConfig` (gateway/types.ts; gateway index has `export *`, likely public)
- `MetricEvent`, `ErrorEvent`, `LogLine` (observability/types.ts), `raStyles` (react/styles.ts), `DictationMode` (ui-core/voice/dictation.ts; ui-core index `export *`)
- Benchmarks (private package, no public exemption; harness-warden): `H3_DEFERRED`, `docsReceiptsSession` (sessions/docs-receipts.ts), `loadDomainDatabase` (tau-bench/loader.ts)

### 1c. Public, keep (zero internal importers by design)
`packages/a2a/src/types.ts` via `export * from "./types.js"`: `A2A_PROTOCOL_VERSION`, `FileContent`, `DataPart`, `A2ARole`, `TaskState`, `A2ATaskStatus`, `AgentProvider`, `AgentInterface`, `SecurityScheme`, `A2AServerConfig`. Likewise any item in 1b flagged "index has `export *`" until proven otherwise.

Orphan guard: `check-orphans.sh` passes (ledger kinds all have writers, baseline empty). Dead-flag count at last audit lives in DEBT-REGISTER.md (not re-read whole).

## 2. Duplicated helpers / copies

| Duplicate | Evidence | Action | Owner |
|---|---|---|---|
| `isRecord` type guard re-declared 28 times (non-test src/ui/server) | `/usr/bin/grep -aE "^\s*(export )?(const\|function) isRecord"`: 8 in apps/cortex/{server,ui}, 1 each in core, eval (exported), llm-provider x2, reasoning, runtime x4, tools x2, trace, ui-core, benchmarks, testing. `asRecord` x4 (channels x2, reasoning x2). Variants differ: trace's omits the `!Array.isArray` check, so they are NOT identical. | Boundary-first fix: one `isRecord` in `@reactive-agents/core` (or runtime-shim), delete copies; decide array semantics once. Respects "2nd instance => fix the boundary". | core-warden to add; each domain warden to delete its copies |
| Provider id/label table hand-kept in 3 Cortex places | `apps/cortex/server/api/models.ts:142` `PROVIDER_LABELS` + `LOCAL_PROVIDERS`; `apps/cortex/ui/src/lib/providers.ts:14` `PROVIDER_FALLBACK` (same 8 ids and labels); `apps/cortex/ui/src/lib/settings-page.ts:28` `KEYED_PROVIDERS` (3 cloud providers, env names; groq/xai absent). Framework already has `packages/llm-provider/src/model-catalog.ts`/`capabilities.ts`. | Single provider descriptor list in llm-provider (id, label, local, env var); Cortex server serves it, UI keeps only a fallback derived from it. Note `KEYED_PROVIDERS` omitting groq/xai is already a drift bug. | provider-warden + cortex-warden |
| `ModelCalibration` key list copied in Cortex | `apps/cortex/server/services/model-calibration.ts:51` `CALIBRATION_KEYS` (7 keys) mirrors the `ModelCalibration` fields in llm-provider/src/calibration.ts. | Derive from the framework type or a framework-exported key list; add a parity test (config-parity.test.ts exists for other cases). | cortex-warden + provider-warden |
| Cortex-side tool-intent handling | `apps/cortex/server/tests/config-parity.test.ts` references `withToolIntent`; commit e35f5a8b8 already removed some copies. Not re-verified for residue in `channel-tool-surface.ts` / `legacy-cli-tools.ts` (migration shims, 55+79 LOC). | Needs owner decision: are `migrateLegacyCliTool*` still required for stored configs? | cortex-warden |

Other tiny shared helpers (each 3-8 copies): `errorMessage` 8 defs, `sleep` 5, `truncate` 5, `stableStringify` 3 (`/usr/bin/grep -aE` def counts). Review before extracting; `stableStringify` x3 is the best candidate (determinism-relevant).

## 3. Stale / orphan files

### 3a. Worktrees (all gitignored, untracked; do not delete without review)
- `.claude/worktrees`: **3.1 GB**, 16 worktrees. 14 `agent-*` dated Nov 6 (09:30-14:21) plus `agent-a16dda...` Nov 11 08:53 (**1.9 GB** alone), `verify-250` Nov 4 (93 MB detached HEAD). 15 `worktree-agent-*` branches: 2 merged into `dev`, 13 **unmerged** (could hold unmerged work: check `git log dev..<branch>` before removal).
- External worktrees registered in `git worktree list`: `~/.claude/jobs/eaddf328/tmp/wt-h3` (detached), `../main-lock` (`fix/docs-docusaurus-link`), `../pr289-verify` (`verify-pr-289`). Needs owner decision.
- Safe action once reviewed: `git worktree remove` per entry + `git worktree prune`, then delete the 13 branches that are fully merged/abandoned. Never `rm -rf` (memory rule: untracked dirs).

### 3b. Untracked-but-present root leftovers (all gitignored; `git ls-files` returns nothing for them)
| Path | Size | Note |
|---|---|---|
| `.turbo/` | 2.9 GB | build cache; regenerable (`turbo` prune). Safe. |
| `.claude/worktrees/` | 3.1 GB | see 3a |
| `signal-data/` | 11 MB | Signal docker data at repo root; verify no live container mount before removal. Needs decision. |
| `.playwright-mcp/` | 26 MB | tool scratch; safe. |
| `.superpowers/` | 4.1 MB | plugin scratch; safe. |
| `.cortex/` | 588 KB | local Cortex db/state; do not delete blindly. |
| `.repo-logs/` | 2.0 MB, 54 files since Nov 3 | `repo test` log output; safe to trim. |
| `.worktrees/`, `.reactive-agents/` | 0 B | empty; safe. |
| `scratch.ts` (root) | 4 KB | readline REPL against `reactive-agents`; gitignored scratch. Safe. |

### 3c. Tracked waste
- `wiki/Research/Harness-Reports/sprint1-canonical-collapse/*.log` - 12 tracked `.log` files, the only tracked logs in the repo. Candidate to archive/delete (owner decision; harness-warden owns Harness-Reports).
- Large tracked evidence: `packages/benchmarks/mastra-vs-ra/results/INVALID-xai-key-bug/cells-*.json` (0.4 MB, named INVALID - candidate to delete, harness-warden); `wiki/Reference/Benchmarks/baseline-2026-04-07/*.txt` (4 files, ~0.3 MB each, pre-v0.18 baseline); `assets/logo.png` 5.6 MB (compress; README-facing). Pack size is 65 MiB, so this is minor.
- No tracked `dist/`, `.tsbuildinfo`, `.sqlite`, `.tgz` (checked `git ls-files`).
- Scripts: every `scripts/*.ts|sh|mjs` (non-check, non-probe) is referenced from package.json, workflows, hooks, tools/repo or AGENTS.md (0 unreferenced). `scripts/probes/` (14 files, e.g. `p1-first-touch.ts` ... `p7-a2a.ts`, `spot-test.ts`): referenced by at most 1-2 wiki/planning docs, no package.json/CI entry. Owner decision (harness-warden): archive probes whose plan shipped.

### 3d. Changesets (236 files in `.changeset/`; 235 pending + config)
- `v0.18.0` tag (2026-11-07) predates **every** pending changeset (0 of them were added before the tag, via `git log --diff-filter=A` + merge-base), and `dev` is 294 commits past it. So none are stale-vs-release; all are un-released work from the last 5 days. 123 `minor` + 156 `patch` lines (multi-package).
- Shortest bodies are ~100-180 chars (e.g. `export-tokenize-tool-name.md`, `core-recall-event-guardrail-abort.md`); no zero-byte files; none lacking frontmatter. No file references a nonexistent package name.
- Likely same-topic overlap (candidates to merge/fold at release): `agentconfig-gateway-ingress.md`, `gateway-ingress-channel-opt-out.md`, `schedule-registry-and-ingress.md` (all gateway ingress). Automated exact-body dupe detection was inconclusive (needs a real script); release-warden should triage the 235 by package before the 0.19 changelog.
- **Config drift:** `.changeset/config.json` `fixed` lists `@reactive-agents/orchestration`, but there is no `packages/orchestration` (35 package dirs, none by that name). Remove entry (release-warden). Also `@reactive-agents/ui-core` is not in the fixed group while sibling UI bindings may be - confirm intentional.
- Release-warden note: `minor` x123 means 0.19.0 is the implied bump; `scripts/release.ts` is the sole stamping path.

### 3e. Stale plans still marked active
23 plans in `wiki/Planning/Implementation-Plans/` (119 total) carry `status: active|in-progress`. Oldest/likely done (project memory says Plans 4-7 shipped on dev and typesafe-judgment exists as `packages/judgment`; verify each before flipping):
`2026-05-23-team-ownership-dev-contract-pilot` (contract ratified 2026-09-03 per AGENTS.md), `2026-09-20-typesafe-judgment-layer` (memory says "NOT YET IMPLEMENTED" but judgment package exists - both stale), `2026-10-02-declarative-config-parity-register`, `2026-10-05-run-level-budget-meter`, `2026-10-05-systemone-decision-backends`, `2026-10-06-island-survival-simulation-demo`, `2026-10-20-{reasoning-think-decomp,runtime-builder-decomp,runtime-reactive-agent-decomp}`, `2026-10-29-{agent-session-control,goals-loops-and-polish,inferred-progress-and-environment-updates,run-posture-plan-mode}`. Action: needs owner decision, then status flip + Planning-Index update. Mechanical once decided.

### 3f. Unused dependencies (declared in `dependencies`, name never appears in any tracked file of that package; script run in scratchpad)
| Package | Unused deps |
|---|---|
| apps/cortex | @reactive-agents/observability |
| apps/cortex/ui | @fontsource-variable/geist (check CSS import by path before removal) |
| apps/examples | guardrails, verification, observability, cost |
| packages/a2a | core |
| packages/benchmarks | reasoning (private pkg; AGENTS tree lists it) |
| packages/cost | memory (AGENTS tree: `cost <- core, judgment, llm-provider, memory`) |
| packages/guardrails | llm-provider |
| packages/identity | core |
| packages/interaction | reasoning, observability |
| packages/prompts | core |
| packages/verification | core, memory |

Caveat: workspace deps also drive turbo build order and may be needed for type-only `.d.ts` resolution; also AGENTS.md dependency tree lists several of these as real edges, so removal also means editing AGENTS.md/architecture-reference. Needs decision per package (owner by package, plus release-warden for published ones). Unused test fixtures: not audited.

## 4. Oversized files
`check-file-size.sh` passes: 25 baselined at ceiling, no new giants outside the ledger. Current src sizes (LOC): `runtime/src/builder.ts` 2200, `reactive-agent.ts` 1987, `benchmarks/tasks/real-world.ts` 1531, `kernel-state.ts` 1299, `local.ts` 1139, `mcp-client.ts` 1117, `runtime.ts` 1105, `act.ts` 1098.
**Gap: the gate only covers `packages/*/src`.** Today's Cortex work (git log since 2026-11-11) grew unguarded files:
- `apps/cortex/server/services/chat-session-service.ts` **1460** LOC (no baseline entry, no gate)
- `ChatPanel.svelte` 899, `runner-service.ts` 855, `server/api/chat.ts` 842, `ui/.../chat-store.ts` 826
Recommendation: extend the gate to `apps/cortex/**` with a ratchet baseline and split chat-session-service (already has many `chat-*.ts` siblings; split by turn/approval/ingest). Owner: cortex-warden; gate edit: harness-warden/repo tooling.
AGENTS.md is 21,926 bytes vs the 22 KB test cap: ~600 bytes of headroom; next edit risks the size test.

## 5. Disk
| Item | Size | Verdict |
|---|---|---|
| `.claude/worktrees` | 3.1 GB | needs review (3a) |
| `.turbo` | 2.9 GB | safe (cache) |
| `~/.bun/install/cache` (outside repo) | 7.5 GB | outside scope, regenerable |
| root `node_modules` | 81 MB | normal |
| per-package `node_modules` (all) | 53 MB | normal; largest packages/reactive-agents 15 MB, a2a 12 MB, observe 9.8 MB |
| `dist/` dirs (untracked, ignored) | 87 MB total; runtime 33 MB, reasoning 18 MB | normal; regenerable |
| git pack | 65 MiB | fine |
| `signal-data`, `.playwright-mcp`, `.repo-logs`, `.superpowers` | 11/26/2/4 MB | see 3b |
Total reclaimable without touching tracked files: about 6.1 GB (worktrees + .turbo).

## 6. Docs drift
Checked and consistent: strategies = 8 (README lines 37, 94, 588 vs `packages/reasoning/src/strategies`), providers = 8 (README vs Cortex provider list), `withToolIntent` exists (`runtime/src/builder.ts:1908`) and cheatsheet/builder-api/examples docs still describe it (not stale). README relative links to repo files: 0 broken (README/CAPABILITIES/ROADMAP/CONTRIBUTING); wiki Hot/Repo-Navigation wikilinks: 0 dead. `wiki/Hot.md` 362 words (<500 cap).
Drift found:
1. README test count is self-contradictory and stale: "13,601 tests ... 10,001 pass / 0 fail / 28 skip / 4 todo (2026-10-12)" (lines 38, 160, 901), "2,100+ files". Pass+skip+todo = 10,033, not 13,601; and project memory's last full run was 9,454 pass / 1,235 files. Owner decision: re-measure or drop the number (honest-claims law); `check-docs-sync` evidently does not cover it.
2. `.changeset/config.json` references nonexistent `@reactive-agents/orchestration` (see 3d).
3. `apps/docs/.../builder-api.md:146` describes `withToolIntent` only as "Configure tool intent." while the cheatsheet documents default `"capability"` vs legacy `"message"`; not wrong, but thin. Also `AGENTS.md` dependency tree lists edges that are not imported (3e table).
4. Memory files stale vs repo (outside repo scope but affects agents): project MEMORY still says "35→34 pkgs" and typesafe-judgment "NOT YET IMPLEMENTED"; repo has 35 package dirs and a judgment package. Run `prune-memory`.
Not audited: legacy `channels` doc references and `requiresTools` doc mentions (`requiresTools` appears only in benchmarks task definitions, 8 files, not in docs: no stale doc reference found).

## Cleanup plan

### A. Safe mechanical (batch)
1. Clear `.turbo` cache (2.9 GB), `.playwright-mcp` (26 MB), `.superpowers`, empty `.worktrees`/`.reactive-agents`, trim `.repo-logs` (all gitignored).
2. Delete root `scratch.ts` (gitignored scratch).
3. Remove `@reactive-agents/orchestration` from `.changeset/config.json`.
4. Delete the 6 Cortex dead exports (1a) after `bun run repo verify apps/cortex`.
5. Delete `packages/benchmarks/mastra-vs-ra/results/INVALID-xai-key-bug/` and `wiki/.../sprint1-canonical-collapse/*.log` only after harness-warden OKs (low risk).
6. Flip clearly-shipped plan statuses (3e) once owner confirms; update Planning-Index.

### B. Needs sole-caller proof (dispatch owning warden)
1. Framework candidates in 1b (runtime `mergeReasoningConfigForRuntime`, RI `computeEntropyStats`, llm-provider `TEXT_ONLY_RULES`/`_resetTokenizerFactorsCacheForTesting`, benchmarks `H3_DEFERRED`/`docsReceiptsSession`/`loadDomainDatabase`, reasoning/runtime types). Grep word + `export *` reachability + dynamic string use, per symbol.
2. Unused-dependency removals (3f), package by package with `bun run build` + typecheck (build order impact) and AGENTS.md tree edit.
3. `isRecord` consolidation (28 copies): add canonical home first, delete after.

### C. Needs owner decision
1. 16 worktrees (3.1 GB), 13 unmerged `worktree-agent-*` branches, 3 external worktrees: triage unmerged work, then `git worktree remove`.
2. Cortex provider-table / calibration-key unification into framework (cross-package: provider-warden + cortex-warden).
3. Extend file-size gate to `apps/cortex` and split `chat-session-service.ts` (1460 LOC).
4. README test-count claim; `signal-data/` fate; probe scripts archive; `assets/logo.png` compress; changeset triage/folding of gateway-ingress trio (release-warden).

## Top 10
1. 3.1 GB `.claude/worktrees`, 13 unmerged branches (C1)
2. 2.9 GB `.turbo` cache (A1)
3. `chat-session-service.ts` 1460 LOC outside the file-size gate (C3)
4. Provider tables hand-copied 3x in Cortex, and `KEYED_PROVIDERS` already drifts (omits groq/xai) (C2)
5. 28 `isRecord` copies with inconsistent semantics (B3)
6. README test count contradictory/stale (C4)
7. `.changeset/config.json` names nonexistent `orchestration` pkg (A3)
8. 6 sole-caller-proven dead Cortex exports (A4)
9. 12 unused declared deps across 11 packages; AGENTS dep tree disagrees with imports (B2)
10. 23 plans still `status: active`, several shipped (A6/3e); 235 pending changesets (all post-v0.18.0, triage before 0.19)
