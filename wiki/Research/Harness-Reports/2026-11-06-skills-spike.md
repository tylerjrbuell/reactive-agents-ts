---
type: harness-report
status: final
created: 2026-11-06
tags: [skills, spike, cortex, workspace, activate-skill, harness-warden]
---

# Skills spike: discovery, activation and workspace (2026-11-06)

**Question (owner, 2026-11-06).** Cortex skills appear locked to the Cortex server directory, not the chat's workspace. Skills should also be activatable by the agent mid-run (Claude Code `Skill` tool / opencode style), not only pinned.

**Method.** Spike before build: read the pipeline end to end, then zero-token probes with the scripted `test` provider wrapped in a request recorder (`withReplayLLM`). Each probe records every LLM request: tool names on the wire, whether the catalog / skill names / a unique body marker (`ZEBRA-SKILL-BODY-7741`) appear in the system prompt or messages. Probe scripts and raw outputs are in `/home/tylerbuell/.claude/jobs/eaddf328/tmp/skills-spike/` (`probe.ts`, `probe-forced.ts`, `probe-cortex.ts`, `scan-traces.ts`, `*.out`). Hermetic runs use `HOME=<empty tmp dir>` so `~/.agents/skills` does not leak into the catalog.

**Verdict in one line.** Pinned / relevance-matched skills work, but only against the process cwd. The workspace is never consulted. Agent-driven activation does not work on any path: the tool is never offered, and a forced call returns `{"status":"queued"}` and nothing is ever injected.

## 1. Pipeline map (as built)

| Step | Where | Scope |
|---|---|---|
| `.withSkills({ paths, activate })` stores config; throws if `paths` is empty | `packages/runtime/src/builder/withers/capability-progress.ts:219` | builder |
| Config copied to runtime options | `packages/runtime/src/builder/build-effect/runtime-construction.ts:592-601` | build |
| `SkillResolverService` layer built **only when `paths` non-empty**; `projectRoot: options.skillDiscoveryRoot ?? process.cwd()` | `packages/runtime/src/runtime.ts:735-768` | **per runtime (process cwd)** |
| `skillDiscoveryRoot` is never set by the builder (only tests set it) | `packages/runtime/src/runtime-types.ts:901`; no builder writer | n/a |
| `discoverSkills` scans `customPaths` (relative paths resolve against **process cwd** via `fs`, not against `projectRoot`), then `<root>/.<agentId>/skills`, `<root>/.agents/skills`, `~/.agents/skills`, `~/.reactive-agents/skills` | `packages/reactive-intelligence/src/skills/skill-registry.ts:190-206` | fs scan per run, root fixed per runtime |
| `resolve()` merges learned (SQLite) and installed; `selectActivated` = expert + explicit `activate` + top-2 relevance (floor 2, non-tentative) + prerequisites | `packages/reactive-intelligence/src/skills/skill-resolver.ts:149-177, 326-364` | per run |
| Bootstrap builds `skillCatalogXml` (with `catalogOnlyHint`) and `activatedSkillsXml` (`<skill_content>` envelopes) onto `ctx.metadata` | `packages/runtime/src/engine/bootstrap/skill-postprocess.ts:83-135` | per run |
| `reasoning-think.ts` threads them as `skillsContext {catalogXml, activatedXml}` | `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts:113-117` | per run |
| Runner copies `skillsContext` into kernel state; `project()` renders a `## Skills (procedural instructions — follow these, do NOT call them as tools)` section in the cached system prefix | `packages/reasoning/src/kernel/loop/runner.ts:336`; `packages/reasoning/src/assembly/stages/system-prompt.ts:78-89` | per run, run-stable |
| `activate-skill` tool definition exists but is **never registered or appended** to the tool surface; `get-skill-section` likewise | `packages/tools/src/skills/activate-skill.ts:5`, `get-skill-section.ts:3`; absent from `packages/reasoning/src/kernel/capabilities/act/tool-capabilities.ts:88-196` | n/a |
| Even if registered, the native-FC wire filter strips any `META_TOOLS` name without `scope: "domain"`; `activate-skill` is in `META_TOOLS` | `packages/reasoning/src/kernel/capabilities/reason/think.ts:639-643`; `packages/reasoning/src/kernel/state/kernel-constants.ts:24` | per pass |
| If called anyway, act intercepts it unconditionally and returns an ack only: `{ ok: true, skillName, status: "queued" }` | `packages/reasoning/src/kernel/capabilities/act/act.ts:431-437`; `meta-tool-handlers.ts:135-154`; `packages/tools/src/skills/activate-skill.ts:89-106` | per call |
| The "dispatcher on a later tick" that the ack relies on: RI `evaluateSkillActivate` needs `params.availableSkills`, which **no caller passes** (all 3 `evaluate(...)` sites) | `packages/reactive-intelligence/src/controller/evaluators/skill-activate.ts:7-8`; `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:267-314`; `strategies/plan-execute/reflection-entropy.ts:124`; `strategies/tree-of-thought.ts:618` | never fires |
| Even if it fired: handler loads from `process.cwd()/.agents/skills/<name>/SKILL.md` (not the resolver, not the workspace) and the patch lands in `pendingGuidance.errorRecovery`, which `think` clears after one render | `packages/reactive-intelligence/src/controller/handlers/skill-loader.ts:6-18`; `reactive-observer.ts:516-519`; `think.ts:188-189` | one turn only |

**Workspace plumbing (exists, unused by skills).** Per-run working directory: `run(task, { workspace })` → `packages/runtime/src/agent/run-task-effect.ts:225, 650-655` → `startRun` binds `fileRootSlot` (precedence: run `workspace` > `.withTools({ workspace })` `AgentWorkspace` > ALS `withFileRoot` > `process.cwd()`), `packages/runtime/src/engine/start-run.ts:11-21, 59-104`. Readable in-run via `currentFileRoot` (`packages/tools/src/skills/file-root.ts:66-69`). Nothing in the skill path reads it.

### Cortex

| Step | Where |
|---|---|
| Skill picker / Lab listing scans bases `[CORTEX_SKILL_SCAN_ROOT, process.cwd(), apps/cortex]` × `[.agents/skills, skills, .claude/skills, apps/cortex/.agents/skills]` | `apps/cortex/server/services/skill-directories.ts:14-64`; `skill-filesystem.ts:50-90` |
| Paths are relativized to server cwd, **else to the Cortex app root**, and returned relative | `apps/cortex/server/services/skill-filesystem.ts:27-39` |
| Pin (`/skills` toggle) writes `paths: [skillRoot(skillDir)]` (relative) + `activate: [name]` | `apps/cortex/ui/src/lib/chat-config-patch.ts:18-42` |
| Agent-proposed `pin-skill` (approval-gated, next turn) uses `discoverSkillDirectoryPaths()` (relative) | `apps/cortex/server/services/chat-proposal-service.ts:251-256`; `proposal-host.ts:42-45` |
| Chat agent build: `withSkills(params.skills)`; workspace only bound when tools are enabled | `apps/cortex/server/services/build-cortex-agent.ts:358-363`; `chat-session-service.ts:1046-1057, 1129-1131` |

The chat's workspace never reaches skill listing or skill resolution. The framework resolves the relative paths against the server process cwd (`runtime.ts:745`).

## 2. Probe results (observed)

All runs: provider `test`, reactive strategy, task "Answer briefly: what is 2+2?" (no relevance match, so nothing auto-activates). Outputs in `skills-spike/*.out`.

### (a) Discovery vs workspace (`probe.ts`)
cwd = empty tmp dir C, workspace W holds `.agents/skills/xskill/SKILL.md`, `withSkills({ paths: [".agents/skills"] })`.

| Case | Skill in | Catalog skill names seen by model |
|---|---|---|
| `cwd-control` | C (cwd) | `xskill` |
| `ws-run` (`run(task, { workspace: W })`) | W | none (no catalog at all) |
| `ws-builder` (`.withTools({ workspace: W })`) | W | none |
| `ws-abs-path` (absolute path into W) | W | `xskill` |
| `home-leak` (real HOME) | C | `xskill`, `token-optimization`, `find-skills`, `context7-mcp` |

Result: the workspace has no effect on which skills load. Only cwd-relative or absolute paths work. Every agent with `.withSkills()` also lists the user's `~/.agents/skills` (3 skills here) in its catalog.

### (b) Agent activation (`probe.ts activate-*`, `probe-forced.ts`)
- **Not on the surface.** In every request, the wire tools are `discover-tools` (plus domain tools). `activate-skill` and `get-skill-section` never appear (`activate-ri-on.out`, `activate-ri-off.out`, `section.out`).
- **Instrument control.** The scripted call to an un-offered tool is refused at the think-phase gate ("Your last replies were tool-call text that could not be executed", `activate-ri-off.dump.out`). That refusal is correct behavior and is not the defect. To get past it, `probe-forced.ts` registers the stock `activateSkillTool` as a user tool (`allowedTools: ["activate-skill","list-directory"]`). It is still absent from the wire (the `think.ts:641` META filter), but the scripted call now reaches act.
- **Forced call outcome (RI on and RI off, identical).** Act's meta registry wins over the user handler (`sawUserHandler: false`). The model receives `[tool] {"ok":true,"skillName":"xskill","status":"queued"}`. The skill body marker never appears in any of the 3 following think requests or in the synthesize request (`bodyInSys: false, bodyInMsgs: false` throughout; `forced-ri-on.out`, `forced-ri-off.out`). The run then ends with `success: false`.
- **Compaction survival.** Moot for agent activation, since nothing is ever delivered. Pinned (`activate: [...]`) content lives in `skillsContext.activatedXml`, inside the system prompt, so compaction cannot drop it (covered by `packages/runtime/tests/skills-system-prompt-separation.test.ts:66-91`). The RI carrier (`pendingGuidance.errorRecovery`) would last one turn only.
- **RI disabled.** Same as RI enabled. Activation does not depend on RI, because it never happens on either path.

### (c) Cortex listing (`probe-cortex.ts`, no server started)
| Server cwd | Roots scanned | Workspace skill listed | Pin writes | Pin resolves to |
|---|---|---|---|---|
| repo root | repo `.agents/skills`, `.claude/skills`, `apps/cortex/.agents/skills` (28 skills) | no | `paths: [".agents/skills"]` | repo `.agents/skills` (works) |
| neutral dir | `apps/cortex/.agents/skills` only (1 skill) | no | `paths: [".agents/skills"]` for `cortex-lab-test` | `<neutral cwd>/.agents/skills`: **wrong dir, so the pinned skill silently does not load** |

## 3. Trace census (`scan-traces.ts`)

| Corpus | Traces | `activate-skill` calls | `get-skill-section` calls | Catalog in prompt | `<skill_content>` | RI `skill-activate` decisions |
|---|---|---|---|---|---|---|
| spike-pack `runs.jsonl` (H3, 2026-11-04..06) | 930 | 0 | 0 | 0 | 0 | 0 |
| plus `~/.reactive-agents/traces` | 3,942 | 0 | 0 | 7 | 0 | 0 |

All 7 catalog traces are this spike's own probe runs (task "what is 2+2", provider `test`). So no recorded real run has used skills. H3 never enables `.withSkills()`, so the H3 corpus carries no evidence about skill behavior either way. Side gap: `run-started.config.mechanisms` does not record whether skills were configured, so `rax-diagnose` cannot see it.

## 4. Defects

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D1 | Skill discovery root is per-runtime `process.cwd()`. Run workspace and builder workspace are ignored. Relative `paths` resolve against cwd even when `skillDiscoveryRoot` is set (doc at `runtime-types.ts:897-901` says otherwise). | `runtime.ts:745`; `skill-registry.ts:196-201`; probe (a) | runtime-warden (runtime.ts, skill-postprocess.ts), kernel-warden (skill-registry/resolver, `packages/reactive-intelligence`) |
| D2 | `activate-skill` is never put on the tool surface, and the META wire filter would strip it anyway. | `tool-capabilities.ts:88-196`; `think.ts:639-643`; probe (b) | kernel-warden |
| D3 | `activate-skill` handler is an ack-only stub ("queued") that injects nothing. The promised dispatcher path is unreachable: `availableSkills` is never passed to `evaluate`. Its loader is cwd-based, and its carrier is a one-turn `errorRecovery` guidance slot. This is dead code that lies to the model. | `activate-skill.ts:89-106`; `meta-tool-handlers.ts:131-154`; `evaluators/skill-activate.ts:7-8`; `reactive-observer.ts:267-314, 516-519`; `skill-loader.ts:6-18`; probe (b) | tools-warden (activate-skill.ts), kernel-warden (act, RI handler/evaluator/loader) |
| D4 | The catalog hint tells the model to call `get_skill_section("x","full")`. No such tool is registered, and the name uses the wrong separator. The section header says "do NOT call them as tools". The model gets no working way to load a catalog-only skill. | `skill-resolver.ts:300-306`; `system-prompt.ts:80`; `get-skill-section.ts` (unregistered) | kernel-warden |
| D5 | Cortex skill listing ignores the chat workspace. Pins write cwd-relative paths that break when the skill came from the Cortex app root and server cwd ≠ that root. | `skill-directories.ts:37-48`; `skill-filesystem.ts:27-39`; `chat-config-patch.ts:18-41`; probe (c) | cortex-warden |
| D6 (minor) | `~/.agents/skills` + `~/.reactive-agents/skills` are merged into every `.withSkills()` catalog, with no way to opt out from the public API (`skipGlobalPaths` is resolver-internal). Skills are absent from `run-started.config`. | `skill-registry.ts:202-205`; probe `home-leak`; trace census | kernel-warden (registry), runtime-warden (run-started config) |

## 5. Already canonical

- Explicit pin (`activate: [...]`) and task-relevance auto-activation inject the full `<skill_content>` into the run-stable system prefix. They survive compaction and carry injection-safe escaping (`activate-skill.ts:26-80`).
- Learned (SQLite) + installed merge with precedence; prerequisite closure.
- The per-run file root (`fileRootSlot` / `currentFileRoot`) is exactly the primitive skill resolution should read.
- Cortex's approval-gated `pin-skill` proposal is a valid "persist for later turns" path. It is not mid-run activation.

## 6. Smallest design that meets both asks

One coordinated change set, in three parts.

**A. Resolve skills against the run's workspace** (runtime-warden + kernel-warden)
1. `skill-postprocess.ts` reads `currentFileRoot` (already run-scoped) and passes it as `root` to `resolver.resolve(...)`.
2. `SkillResolverService.resolve` accepts an optional `root`. `discoverSkills` resolves relative `customPaths` with `path.resolve(root, p)` and scans `<root>/.agents/skills`. Precedence follows the file root: run `workspace` > `.withTools({ workspace })` > `skillDiscoveryRoot` > cwd. `runtime.ts:745` then holds only the fallback.
3. Record `skills: { roots, catalogCount, activated }` in `run-started.config` (or a `skills-resolved` trace event). This lets `rax-diagnose` see it.

**B. One first-class activation action** (kernel-warden + tools-warden)
1. When `skillsContext.catalogXml` is present, `tool-capabilities.ts` appends `activate-skill` with `scope: "domain"`, the same pattern as brief/pulse/todo at `:88-90`. It then survives the native-FC filter.
2. Replace the ack stub. The handler looks up the skill in the run's resolved set (thread `resolvedSkills` name→instructions into `KernelInput.skillsContext`, no fs read, no cwd). It appends the `buildSkillContentXml` envelope to `state.skillsContext.activatedXml`. It returns a short result ("xskill loaded; its instructions are now in your Skills section"), or "unknown skill, available: …". Instructions then drive every later turn and survive compaction, because they live where pinned skills live. Cache cost: one prefix invalidation per activation. Dedupe repeat activations.
3. Delete the dead path: `activateSkillHandler` "queued", the RI `skill-activate` evaluator/handler/`skill-loader.ts`, and the `inject-skill-content` patch kind. Also delete unregistered `get-skill-section`, or fold "section" into an optional `activate-skill` arg. Sole-caller check done for the RI path (3 `evaluate` sites, none pass `availableSkills`).
4. Fix the catalog hint and section header to point at `activate-skill` ("call activate-skill to load a skill's full instructions").

**C. Cortex follows the workspace** (cortex-warden)
1. `GET /api/skills/files` takes the session workspace as the primary scan base (before server cwd and app root).
2. Pins store absolute paths, or `.agents/skills` relative once A lands (relative then means workspace-relative).
3. When a chat has a workspace, default `skills.paths` to `[".agents/skills"]` so workspace skills are discoverable without manual setup. Mid-run activation then comes from B with no Cortex change.

**Verification plan (after fix).** Re-run `probe.ts ws-run|ws-builder` (expect `xskill` in catalog) and `probe-forced.ts` without the user-tool workaround (expect `activate-skill` on wire, body marker present on every subsequent request including after a forced compaction). Then run an A/B on ≥2 tiers with a skill-requiring task. Skills are default-off, so no H3 regression is expected, but run H3 targeted cells anyway to check that the system-prompt change is inert when no catalog exists.
