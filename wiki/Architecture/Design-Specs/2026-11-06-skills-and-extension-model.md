---
type: design-spec
status: draft
created: 2026-11-06
tags: [skills, plugins, extension, harness]
---

# Skills and the extension model (design spec, draft)

**Owner asks (2026-11-06).** (1) Skills resolve against the run's workspace, and global `~/.agents/skills` becomes opt-in. (2) Skills are first-class and the agent can activate them mid-run. (3) Activated instructions live in a hybrid home: not system-prompt-only (cache breaks on each activation), not tool-result-only (compaction drops them). (4) One coherent extension model that places skills next to plugins/mods.

**Builds on:** spike [[../../Research/Harness-Reports/2026-11-06-skills-spike]] (D1-D6). Plan 9 [[../../Planning/Implementation-Plans/2026-11-04-architecture-convergence-program]]: principles, 1R run scope, Phase 4 guidance channel, and "Extension points (plugins)".

## 1. Problem and evidence

Today pinned and relevance-matched skills work, but only against the process cwd. In-run activation is dead on every path. The spike counted 0 `activate-skill` calls in 3,942 traces.

- **D1.** The discovery root is `options.skillDiscoveryRoot ?? process.cwd()`, fixed per runtime (`packages/runtime/src/runtime.ts:745`). Relative `paths` resolve against cwd (`skill-registry.ts:196-201`). The run's `workspace` never reaches skills.
- **D2.** `activate-skill` is never put on the tool surface (`tool-capabilities.ts:88-90` appends brief/pulse/todo only). The META wire filter would strip it anyway (`think.ts:639-643`, `kernel-constants.ts:24`).
- **D3.** The handler returns `{status:"queued"}` and injects nothing (`activate-skill.ts:89-106`, `meta-tool-handlers.ts:131-154`). The RI evaluator never fires, because no caller passes `availableSkills` (`evaluators/skill-activate.ts:7-8`). Its loader is cwd-based (`handlers/skill-loader.ts:6-18`).
- **D4.** The catalog hint names a tool that does not exist: `get_skill_section` (`skill-resolver.ts:300-306`). The section header says "do NOT call them as tools" (`assembly/stages/system-prompt.ts:80`).
- **D5.** Cortex lists skills and writes pins relative to the server cwd or the app root, not the chat workspace (`skill-directories.ts:14-64`, `skill-filesystem.ts:27-39`).
- **D6.** Global skill dirs are always merged into the catalog (`skill-registry.ts:202-205`). Skills are absent from `run-started.config`.

## 2. Prior art (fetched 2026-11-06)

| System | Catalog | Body delivery | After compaction |
|---|---|---|---|
| Claude Code ([docs](https://code.claude.com/docs/en/skills)) | name+description in context; description+`when_to_use` capped at 1,536 chars | "enters the conversation as a single message and stays there across later turns"; a duplicate re-invoke adds a short "already loaded" note | "re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each", 25,000-token combined budget |
| opencode ([skills](https://opencode.ai/docs/skills/)) | `<available_skills>` inside the `skill` tool description; project paths `.opencode/.claude/.agents/skills`, walking up to the git worktree; global under `~` | "loaded on-demand via the native `skill` tool" | not documented |
| Codex ([skills](https://learn.chatgpt.com/docs/build-skills)) | name+description+path; at most 2% of the context window by default (`skills.max_context_tokens` ≤10,000); scans `.agents/skills` from cwd up to repo root, then `$HOME/.agents/skills` | full `SKILL.md` read on selection, explicit (`$`, `/skills`) or implicit | not documented |
| Cursor ([rules](https://cursor.com/docs/context/rules)) | Always / Auto-attached (globs) / Agent-requested (description) / Manual (@) | rule bodies placed at the start of context | n/a |
| Hermes ([prompt assembly](https://hermes-agent.nousresearch.com/docs/developer-guide/prompt-assembly)) | skills index in the cached system prompt; a changed index goes out as a one-shot note on the per-turn user-message channel, and the cached prompt is rebuilt only at compaction | via `skill_view(name)` (where the body lands is not documented) | the rebuild boundary is compaction |
| Goose ([recipes](https://block.github.io/goose/docs/guides/recipes/recipe-reference)) | recipe = `instructions` + `extensions` (MCP) + `retry.checks` (shell, exit 0 = success) | n/a | n/a |
| opencode plugins ([plugins](https://opencode.ai/docs/plugins/)) | JS/TS module returning hooks (`tool.execute.before/after`, `experimental.session.compacting`); can add tools | n/a | n/a |

**Anthropic caching** ([docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)): the prefix order is `tools` → `system` → `messages`. A change at one level invalidates that level and every later level. A tool-definition change "invalidates the entire cache". Write costs 1.25x (5 min TTL), read costs 0.1x. Automatic caching moves the breakpoint forward as the conversation grows, so appending messages keeps the cached prefix. Local engines (llama.cpp/Ollama KV reuse) are also prefix-based.

**Consensus:** catalog up front, body on demand as an appended message, and re-attach after compaction. Nobody mutates the system prompt mid-session.

## 3. Taxonomy: two user primitives, one composite

| Concept | What it is | Code? | Status |
|---|---|---|---|
| **Tool** | a typed callable the model invokes | yes | exists (`defineTool`) |
| **Skill** | a declarative package: `SKILL.md` (name, description, procedure body) plus optional bundled files. Teaches *how*. agentskills.io layout. | **no** | fix (this spec) |
| **Hook** | `.withHarness(h => h.tap/transform/on)` over pipeline tags; `compose` killswitches build on it | yes | exists (`core/src/services/harness-pipeline.ts`) |
| **Plugin** | a code module that registers typed extension points: tools, hooks, strategy, acceptance check, kernel operation, guidance producer, dialect, tier profile, **and skills** | yes | Plan 9, after Phase 4 |
| **Profile** | a plugin that is a preset bundle (the coding-agent profile) | yes | Plan 9 |

**Recommendation.** Users get exactly two primitives.

- **Skills are content.** Anyone can write one, it is portable across Claude Code, Codex and opencode, and it runs no code.
- **Plugins are code.** They register extension points. A plugin may *ship* skills (Claude Code's `<plugin>/skills/` pattern), the same way it ships tools.

A skill is not a degenerate plugin. Keeping it pure data keeps it portable, reviewable and safe to discover from an untrusted workspace. The two compose in one direction only: plugin ⊃ skills. Hooks and profiles are not new primitives. A hook is the observation surface a plugin uses, and a profile is a plugin.

**Do not build:**
- framework-executed skill scripts;
- a skill-specific guidance or memory subsystem;
- RI-driven activation;
- mid-run tool-surface changes from a skill (`allowed-tools` would invalidate the whole cache);
- a deactivate tool;
- a skill marketplace;
- plugin packaging, versioning or sandboxing (Plan 9 defers these to after Phase 4).

## 4. Skill lifecycle

**Discovery (per run).** Discovery runs in bootstrap (`engine/bootstrap/skill-postprocess.ts:83-135`). It reads the run's file root (`currentFileRoot`, `packages/tools/src/skills/file-root.ts:66-69`). That root is bound by `startRun` with precedence run `workspace` > `.withTools({workspace})` > ALS > cwd (`engine/start-run.ts:11-21`). Discovery order:

1. `<root>/.agents/skills` and `<root>/.<agentId>/skills`;
2. configured `paths`, where a relative path resolves against `root`, not cwd;
3. only with `global: true`: `~/.agents/skills` and `~/.reactive-agents/skills`.

On a name collision, earlier wins. Learned (SQLite) skills still merge with precedence (`skill-resolver.ts:326-364`). `runtime.ts:745` keeps only the fallback root.

**Catalog.** The catalog lists name and description for each skill, capped at 1,536 chars per entry and a total of 2% of the window (Codex rule). It renders once in the system prefix and is frozen for the run, so it is cache-stable. The header becomes "Skills: call `activate-skill` to load one before you start that kind of work."

**Activation.** All four sources go through one path that writes one ledger fact:
- the agent calls `activate-skill` (D2/D3 fix);
- the caller pins skills with `withSkills({activate})` or `run(task, {skills:{activate}})`;
- a Cortex user types `/skill name`, which is a per-turn pin, because each chat turn is a run;
- relevance auto-activation, which exists today and is kept until measured (§8).

**Delivery.** See §5.

**Bundled files.** `activate-skill({name, file?})` reads a file inside that skill's directory only. This folds in and deletes `get-skill-section`. It reaches global skills that sit outside the confined file root, and it never reads outside the skill directory.

**Deactivation.** None. A body lives until the run ends. A duplicate activation returns "already loaded" (Claude Code rule).

**Compaction.** See §5.

**Record.**
- `run-started.config` gains `skills: { roots, catalog: [{name, sha256}], pinned }`, which closes the D6 gap for `rax-diagnose`.
- Each activation appends a ledger fact `skill-activated { name, source, sha256, via: "agent"|"pin"|"user"|"relevance", iteration }`.

**Replay.** The body arrives as a recorded tool result, so `makeReplayToolLayer` replays it byte-for-byte. A catalog sha mismatch against the recorded `run-started.config` is a replay warning, not a failure.

## 5. Placement decision (the hybrid)

**Cost model.** Example numbers: system prefix S = 4k tokens, catalog C = 0.3k, skill body B = 1.5k, history at activation H = 15k, 10 turns after activation. Write = 1.25x, read = 0.1x, uncached = 1.0x. Figures are token-equivalents billed on Anthropic.

| Option | Activation turn | Each later turn | Survives compaction | Adherence |
|---|---|---|---|---|
| A. System prompt (today's pin path, applied mid-run) | system + messages rewritten: (S+C+B+H)×1.25 ≈ **26k** (vs ≈2k if cached) | B read in prefix: 0.15k | yes | strongest placement |
| B. Tool result only | B×1.25 ≈ 1.9k | 0.15k | **no** (dropped oldest-first) | decays with distance |
| **C. Hybrid (pick)** | B×1.25 ≈ 1.9k | 0.15k + pin ≈ 0.04k uncached | yes (protected) | body + per-turn pin at the tail |

Over 10 turns, A costs about +24k per activation and C about +2.3k, so C is roughly 10x cheaper. Each further activation adds the same again under A. On Ollama, A also forces a full re-prefill of S+H, which costs seconds of latency on local hardware. Pins made before turn 1 cost nothing under either option.

**C, concretely:**

1. **Catalog** in the system prefix, frozen per run. The `activate-skill` schema is static: the catalog is not in its description, and it is appended at run start only when the catalog is non-empty. The tool array therefore never changes mid-run.
2. **Body** delivered once as the `activate-skill` tool result, in the `buildSkillContentXml` envelope (`activate-skill.ts:26-80`, escaping kept). The observation carries `preserveOnCompaction: true`. That flag already exists and is LIVE: compaction protects preserved blocks (`assembly/compaction.ts:209`, fed by `from-kernel-state.ts:123`). Today it is set only on failures (`kernel/utils/observation-helpers.ts:80`).

   Because compaction here is a re-projection that drops whole blocks, not an LLM summary, a protected block simply stays. **No re-attach step is needed.** This is simpler than Claude Code's approach, which needs re-attach because it summarizes.

   A per-run skill budget bounds what is pinned forever: 5k tokens per body (truncate, with a note that names `activate-skill({name, file})` for the rest) and 10% of the window in total. An activation that would exceed the budget is refused with a message.
3. **Pin.** One line per turn while a skill is active, rendered by the guidance channel (`kernel/state/guidance-channel.ts`) into the request-only trailing user message (`think.ts:621-626`). That message never enters the persisted thread or the cached prefix. Example: `Active skill: release-notes. Follow its procedure; next unchecked step: "run check-notes.sh".` It is a new `GuidanceSignal` kind with one producer and is counted by `meta.guidanceCost`. The pin is a **new mechanism** and stays lift-gated (§8).

Pinned and relevance skills keep today's system-prefix placement (`system-prompt.ts:78-89`), because before turn 1 it costs nothing. Moving them to the message home as well (one home) is a measured change, not part of the fix.

## 6. Adherence through existing primitives

The design adds no new subsystem. It ties into three primitives that already exist:

- **Checklist.** If a skill declares steps (frontmatter `metadata.steps: [...]`, an agentskills.io-compatible extension field), activation stages advisory `checklist-item` facts (`core/src/types/checklist.ts:33`, staged like `todo` in `checklist-round.ts`). The existing opt-in `checklist-reminder` (`reflect/checklist-reminder.ts`) and the pin then name the next unchecked step. Steps are not parsed out of prose: a skill without declared steps gets the name-only pin. This keeps it deterministic over LLM-driven.
- **Exit gate.** A skill's `metadata.checks` become acceptance checks that the exit gate disposes. The gate already treats "model said done" as a proposal (Plan 9 2b, `6a2b76c47`). This waits for the `AcceptanceCheck[]` point (Plan 9 extension table). A check is a shell command, so it runs only when the run has `terminal: true` and the check is approved by the HITL policy. Skill content stays non-executing on its own. See open question 2.
- **RunContract.** Not touched. Skills inform the agent; they do not add contract requirements.

## 7. Public API and migration

```ts
// workspace discovery only (.agents/skills under the run workspace); today this throws
.withSkills()
.withSkills({ paths: ["docs/skills"], activate: ["release-notes"], global: true })
agent.run(task, { workspace: "/repo", skills: { activate: ["release-notes"] } })

// Plan 9 plugin surface, after Phase 4. Shown for placement only; do not build now.
.withPlugins([codingAgent({ checks: ["bun test"] })])  // plugin = { name, tools?, skills?, harness?, strategy?, checks?, guidance? }
```

**Migration.** `withSkills({paths, activate})` keeps working, but relative `paths` now mean workspace-relative. When no workspace is bound, the root is cwd, which matches today. The globals leaving the catalog is a breaking change: it needs a changeset with "add `global: true`". The `paths`-required throw (`withers/capability-progress.ts:219`) is removed.

**Cortex.**
- `GET /api/skills/files` takes the session workspace as its first scan base.
- Pins store workspace-relative `.agents/skills` (or absolute paths for app-root skills).
- A chat with a workspace defaults to `withSkills()`.
- `/skill name` becomes a per-turn `run(..., {skills:{activate}})` alongside today's persistent toggle (`ui/src/lib/chat-config-patch.ts:18-42`).

**Deleted (sole-caller checked in the spike, re-check per commit):**
- `activateSkillHandler` "queued" (`packages/tools/src/skills/activate-skill.ts:89-106`) and its kernel wrapper (`meta-tool-handlers.ts:131-154`, replaced by the real handler);
- the RI path: `controller/evaluators/skill-activate.ts`, `controller/handlers/skill-activate.ts`, `skill-loader.ts`, and the `inject-skill-content` patch kind;
- `packages/tools/src/skills/get-skill-section.ts` (folded into `file?`);
- the `get_skill_section` hint (`skill-resolver.ts:300-306`) and the "do NOT call them as tools" header;
- `injectSkill` / `SKILL_TIER_BUDGETS` (`skill-injection.ts:10-100`), which only tests call. Verify the sole caller before deleting.

## 8. Work breakdown (ordered; each step has a zero-token gate)

| # | Owner | Work | Zero-token gate |
|---|---|---|---|
| 1 | kernel-warden | `discoverSkills(root, paths, {global})`: relative paths against `root`; globals opt-in; `resolve({root, includeGlobal})` (`skill-registry.ts:190-206`, `skill-resolver.ts`) | tmp-dir unit tests: workspace beats paths beats global; `HOME` hermetic |
| 2 | runtime-warden | `skill-postprocess.ts` passes `currentFileRoot`; `withSkills()` with no args; `global`; `run(task,{skills})`; `run-started.config.skills`; thread `resolvedSkills` (name → body, dir) into `KernelInput.skillsContext` | spike `probe.ts ws-run`/`ws-builder` list `xskill`; `home-leak` lists only workspace skills |
| 3 | tools-warden | `activate-skill` schema `{name, file?}` with a static description; envelope helper kept; delete the ack stub and `get-skill-section` | tool unit tests; `file` cannot escape the skill dir |
| 4 | kernel-warden | append `activate-skill` with `scope:"domain"` when a catalog exists; real handler (lookup, dedupe, budget, `preserveOnCompaction`, `skill-activated` fact); delete the RI path; fix header/hint | spike `probe-forced.ts` **without** the user-tool workaround: tool on the wire, body marker in every later request including after a forced compaction; **system-prompt bytes identical before and after activation**; prompt goldens unchanged when no catalog |
| 5 | cortex-warden | workspace scan base, workspace-relative pins, default `withSkills()` with a workspace, `/skill` | `probe-cortex.ts` neutral-cwd case pins and resolves the workspace skill |
| 6 | kernel-warden | (lift-gated) active-skill pin `GuidanceSignal`; `metadata.steps` → checklist facts | renderer unit test; `guidanceCost` recorded |
| 7 | after Plan 9 acceptance point | `metadata.checks` → `AcceptanceCheck` | gate conformance suite |

**Live measurement** (harness-warden runs, ablation-warden judges):

- **Task.** A task that cannot be solved without a workspace convention that lives only in a skill. Example: write release notes in a repo-specific format and path, verified by a script. Graded deterministically.
- **Negative control.** A task where no catalog skill is relevant, to measure false activations.
- **Arms.** (a) no skills; (b) catalog + `activate-skill`; (c) b + pin; (d) pinned in the system prefix (upper bound).
- **Tiers.** ≥2: the H3 local pair (cogito, qwen) and one frontier model. n ≥ 5 per cell; gaps under 26pp are noise.
- **Metrics.** activation rate, success, check pass, billed tokens, and the `cache_read`/`cache_creation` split.
- **Decision rule.** The pin ships default-on only if it clears the lift rule (≥3pp, ≤15% billed tokens, both tiers). If (b) ≈ (d) on the local tier, retire relevance auto-activation.

## 9. Build now vs spike first

**Build now (bug fixes, behind opt-in `withSkills`):** D1 (steps 1-2), D2/D3/D4 (steps 3-4), D5 (step 5), D6 plus the run-started record. Default runs carry no catalog, so default behavior is unchanged. H3 targeted cells serve only as a smoke check.

**Spike or measure first (new mechanisms):**
- the per-turn pin;
- the steps → checklist seeding;
- skill-declared checks;
- moving pins out of the system prefix;
- keeping or deleting relevance auto-activation;
- the budget numbers (5k / 10%), which are borrowed from Claude Code, not measured here.

The trace census found zero real skill runs, so the A/B above *is* the frequency spike.

## 10. Open questions for the owner

1. **Workspace discovery default.** Should a bound workspace auto-discover `<root>/.agents/skills` with no `.withSkills()` call (as Codex and Claude Code do), or stay off until `.withSkills()`? Auto-discovery is a default-on change and goes to the lift rule. This spec assumes off outside Cortex.
2. **Skill checks.** Should a skill be allowed to declare shell `checks` (Goose `retry.checks` model), given that this makes skill content trigger execution, gated by `terminal` and approval? Or should checks come only from plugins?
3. **Compatibility paths.** Should discovery also read `.claude/skills` in the workspace for Claude Code compatibility (opencode does), or stay `.agents/skills` only?
