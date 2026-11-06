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

## 11. Advisor record (Fable, 2026-11-06): GO-WITH-CHANGES, adopted

Verified in code: `preserveOnCompaction` protects a block (`compaction.ts:206-212`, fed by `compact-history.ts:43-53`); compaction re-projects blocks and never summarizes, so no re-attach step is needed; guidance is a request-only trailing message (`think.ts:621-627`), outside the cached prefix on Anthropic and Ollama; `currentFileRoot` is bound by `startRun` around bootstrap (`run-task-effect.ts:651`, `start-run.ts:181`); meta-tool results bypass `compressToolResult`. Amendments, which override the sections above:

1. **Budget (blocking).** Per-body cap `min(5k tokens, 10% of the projection window)`, total preserved skill bodies `≤ 20%` of the window (`resolveEffectiveNumCtx`, often 8192 on Ollama). Over the cap, activation refuses with a message naming `activate-skill({ name, file })`. Count the preserved block (`groupBlocks` keeps the whole assistant batch), not just the body. Step 4 gate forces compaction at `num_ctx 8192` with one preserved body and asserts it shrank.
2. **One tool, two result classes (blocking).** `activate-skill({ name })`: preserved envelope, `skill-activated` fact, deduped. `activate-skill({ name, file })`: an ordinary result through `compressToolResult` with a recall ref, never preserved, no fact, size-capped.
3. **Adherence default (blocking).** On activation, the skill's declared `metadata.steps` stage advisory `checklist-item` facts (`checklist.ts:33`) that the model may only flip; the per-turn pin renders the next unchecked step; the exit gate reports open skill steps as advisory. No prose parsing. Pin and steps are ONE lift-gated mechanism (arm c), measured against (b) catalog+activate and (d) body in prefix.
4. "The tools array never changes mid-run" is false today (tool-index promotion `think.ts:650-657`, `discover-tools`). Claim instead: activation changes no tool schema; the step 4 gate asserts the wire tools array is byte-identical before and after an activation.
5. The pin producer re-derives from `skill-activated` and checklist ledger facts each turn (`pendingGuidance` clears per turn, `think.ts:189`); no new `KernelState` field.
6. **Skills carry no checks** (Q2: no). Shell checks are code; they break the content/code cut and "safe to discover from an untrusted workspace". Checks come from plugins; a skill may later reference a plugin-registered check by id. `allowed-tools` (parsed at `skill-registry.ts:39`): delete the parse or document it as ignored.
7. Gate the `act.ts:436` intercept like brief/pulse/todo (only when a catalog exists), so catalog-less runs are byte-identical.
8. Taxonomy kept. If (b) matches (d) on local tiers, relevance auto-activation is deleted, not retired.
9. API kept (`.withSkills()`, `{ paths, activate, global }`, `run(task, { skills: { activate } })`). Q1: workspace auto-discovery stays off outside Cortex (lift-gated). Q3: `.claude/skills` is read as the lowest-precedence compat path. The global opt-in change needs a changeset.
10. Cut now: `get-skill-section`, the RI skill path, `injectSkill` / `SKILL_TIER_BUDGETS` (after a sole-caller grep), the `get_skill_section` hint and the "do NOT call them as tools" header. Cortex `/skill` waits for step 4.

Order: steps 1-5 (with amendments 1, 2, 7 folded in) are bug fixes behind the opt-in `withSkills` and need no lift gate; step 6 is pin + steps as one lift-gated mechanism; step 7 (skill checks) is deleted.

## 12. Tool disclosure modes (owner direction 2026-11-06)

**Owner ask.** `discover-tools` stays useful. Offer explicit tool control for users who want it, plus dynamic modes that load only the tools a task needs, so runs waste fewer turns and tokens. **Builds on:** spike [[../../Research/Harness-Reports/2026-11-06-tool-surface-hiding-spike]], Plan 9 row "Tool disclosure modes", §4-5 above (catalog + on-demand load).

### 12.1 Current state (HEAD `37e1f3912`)

Four internal modes expand into three harness switches (`harness-config.ts:173-196`, `fromDisclosureMode`):

| Internal mode | Switches | Default for | What the model gets on native FC |
|---|---|---|---|
| `full` | no prune | nobody | every permitted schema |
| `index` | prune + index | local tier (`context-profile.ts:160`) | every hidden tool **promoted** to a first-sentence schema on the wire (`tool-index-disclosure.ts:66-76`, `think.ts:650-664`). In effect this is `full` with shorter descriptions, not disclosure. |
| `hybrid` | prune + capped index + `discover-tools` | mid (`:170`) | promoted up to `toolIndexMaxEntries`, the rest via `discover-tools` |
| `discover` | prune + `discover-tools` | large, frontier (`:180,191`) | visible = required + relevant (free keyword match on the task) + used + discovered + meta (`tool-surface.ts:110-128,287-292`); the rest only via `discover-tools` (`tool-capabilities.ts:184-196`) |

The tier is a guess: ollama ⇒ `local`, everything else ⇒ `mid` (`run-envelope-config.ts:42-47`). Users reach the mode through three spellings: `contextProfile.toolDisclosureMode`, `.withHarness({lazyDisclosure, toolDiscovery, toolIndex})`, and the env flags `RA_LAZY_TOOLS` / `RA_TOOL_DISCOVERY` / `RA_TOOL_INDEX`. `.withTools` has no setting.

**Broken or false today:**

1. **The catalog is snapshotted after the builtins opt-in** (`tool-schemas.ts:139-173`), so a plain `.withTools({})` run has an empty catalog. The ablation-warden saw the test provider get only `[discover-tools]` on the wire. `discover-tools` is off on local tiers (158/158 runs) and on for mid/frontier, where it can only answer "nothing". Its answer is now truthful (`f464ae89b`), but `getUnlistedToolCount` has no production caller (only `discover-tools.test.ts:87`), so it cannot say how many tools are registered but not enabled.
2. **Docs and JSDoc claim un-opted builtins stay "callable by name, and discoverable via `discover-tools`".** See `guides/tools.mdx:16` and `builder/types.ts:171-176`; the `adaptive` JSDoc above it says the same ("All tools remain callable by exact name"). Both claims are false. Native calls resolve against the offered surface only (`native-fc-strategy.ts:93-144`).
3. **A permitted but pruned tool is refused.** A native call to a hidden permitted name returns `unresolved-tool-call`. The model now hears why (`bdbda3473`), but the turn is still wasted.
4. **Loading mutates the tools array.** Each discovery or index promotion changes `tools`, and on Anthropic "modifying tool definitions" invalidates the entire cache (§2).
5. **The evidence is thin.** The only wide-surface run (2026-08-12, qwen3.5, n=2, 12 vs 44 tools; `2026-08-12-agentic-overhaul-program.md:361-370`) found:
   - the free keyword match surfaced both needed tools in 8/8 cells;
   - pruning saved 13% of tokens at 12 tools and 40% at 44;
   - `discover-tools` fired 0 times in about 51 cells.

   `RA_TOOL_INDEX` was left KEEP-OPT-IN for lack of power (`2026-09-15-experimental-flag-verdicts.md:145-165`).

### 12.2 Decision on spike question B: **B2** (builtins that are not opted in stay invisible; fix the docs)

**Disclosure and permission are separate axes.** The *permitted set* is:

> registered custom + MCP tools, plus opted-in builtins, plus `allowedTools` / `requiredTools`, minus contract-forbidden tools.

The permitted set decides what *may* run. The disclosure mode decides only how the permitted set is *presented*. Under repair-not-refuse (§12.3), anything in the catalog is callable. So B1 would not just make builtins *discoverable*. It would *grant* `code-execute`, `file-write` and `http-get` by default to every `.withTools()` user. The 2026-05-06 opt-in exists to stop exactly that. Least privilege wins, and a mode setting must never widen permission.

B2 ships with three truth fixes:

- Docs and JSDoc say: "Builtins that are not opted in are not registered for the run: not listed, not discoverable, not callable."
- `getUnlistedToolCount` is wired, so `discover-tools` says "N registered tools are not enabled for this run".
- On an unresolved call to a registered-but-unpermitted builtin name, the run emits a trace and dev-log line naming the fix (`builtins: ["file-read"]`). The developer learns of it on the first run, and the model is still refused truthfully (`bdbda3473`).

**This refines proposal item 2.** The never-zero floor draws only from the permitted set. It never falls back to unpermitted builtins.

### 12.3 Final mode semantics

Public setting: `.withTools({ disclosure: "all" | "index" | "discover" })`. Precedence: explicit value > `contextProfile.toolDisclosureMode` > tier default. Tier never overrides an explicit value. `run-started.config` records the resolved mode and its source.

| Mode | In the prompt | Loadable | Callable | Repairs |
|---|---|---|---|---|
| `all` | every permitted schema, from turn 1 | n/a | permitted set | n/a |
| `index` | loaded schemas, plus a **catalog** of name + one line per permitted-but-unloaded tool in the system prefix (frozen per run) | any catalog entry, via `discover-tools` (exact name or query) | loaded set | a direct call to a cataloged name loads the tool and executes the call in the same turn |
| `discover` | loaded schemas, plus one note with count and categories | any permitted tool, via `discover-tools` search | loaded set | the same, for any permitted name |

**Shared rules:**

- **Never-zero floor (bug fix).** On turn 1, if the permitted domain set is non-empty, the loaded set holds at least one of these sources:
  - required and floor tools;
  - names the task text mentions;
  - the deterministic keyword top-k (k=5, the low end of Anthropic's "3-5 non-deferred" advice; the existing `filterToolsByRelevance`, no LLM call).

  If all three come up empty, `discover-tools` is offered with a non-empty catalog. The empty-catalog answer is therefore unreachable.
- **Offer gating.** `discover-tools` is on the wire only when permitted − loaded is non-empty.
- **The loaded set is monotonic.** It is derived from `tool-loaded` ledger facts, never stored as a mutable field, and tools are never unloaded.
- **Loads are batched and ordered.**
  - One `discover-tools` call loads all of its confident matches (`RELEVANCE_FLOOR = 2`, `discover-tools.ts`), which costs one prefix change.
  - Newly loaded tools are *appended* to the tools array in load order, so earlier entries stay byte-stable.
- **Every load is traced:** `tool-loaded { name, via: "floor"|"task-name"|"keyword"|"discover"|"repair", iteration, cacheEffect: "native-deferred"|"prefix-break" }`.
- **Truthfulness.** The catalog header, the count note and the `discover-tools` description are rendered from the resolved config, following the `shellExecuteToolFor` pattern (`shell-execute-definition.ts:80`). No string names a tool or mode the run lacks.
- **Budget.** The catalog (tools + skills) is capped at 2% of the window (§4). An `index` catalog over budget renders the cap plus "N more: search with `discover-tools`". That replaces `hybrid`.

**Cache behavior per provider** (fetched 2026-11-06):

- **Anthropic.** Uses native deferral. Every permitted tool is sent on every request: loaded tools without `defer_loading`, the rest with `defer_loading: true`. `discover-tools` becomes a *custom client-side search* that returns `tool_reference` blocks, which the API expands inline. Deferred tools are "not included in the system-prompt prefix … The prefix is untouched, so prompt caching is preserved" ([tool use with caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching); [tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-search-tool)). API constraints:
  - at least one tool must be non-deferred (the floor guarantees it);
  - a deferred tool cannot carry `cache_control`, so the breakpoint goes on the last non-deferred tool (check against `anthropic.ts:200,316`);
  - the feature needs Haiku 4.5 / Sonnet 4.5 / Opus 4.5 or newer.

  Older models use the generic path.
- **OpenAI.** Hosted `tool_search` + `defer_loading` exists only in the Responses API for gpt-5.4+, and "changing the loaded tool set will break the model's cache from that point forward" ([tool search guide](https://developers.openai.com/api/docs/guides/tools-tool-search)). Our adapter uses Chat Completions (`openai.ts:373`), so it takes the generic path: append-only batched loads, each one a prefix break from the tools onward.
- **Ollama / local KV.** Prefix reuse only. Chat templates commonly render tools inside the first system turn, so treat any load as a full re-prefill of S+H, which costs seconds locally. The template placement must be verified per model in the gate. The policy here is to preload generously (floor + keyword top-k) and to expect `all` to win on small surfaces. The ablation decides that, not this spec.

### 12.4 One catalog/load module for tools and skills

There is one kernel module (placement via `bun run repo place`). It works over items `{ kind: "tool" | "skill", name, line, sha256 }` and provides:

- `renderCatalog(items, budget)`: a frozen system-prefix block, with one budget shared by both kinds;
- `search(items, query)`: deterministic, lifted from `discover-tools.ts` `rankByQuery` and its floor;
- `load(kind, name, via)`: appends one ledger fact (`tool-loaded` / `skill-activated`, §4).

Delivery is the only fork. A tool's schema goes on the wire, as a `tool_reference` on Anthropic. A skill's body becomes a preserved tool result (§5).

**Replaces / deletes** (run a sole-caller grep per commit):

- index promotion: `buildToolIndexCallableSchemas` / `buildToolIndexText` (`tool-index-disclosure.ts`, `think.ts:650-664`), the `hybrid` mode and `toolIndexMaxEntries`;
- the `discoveredFromCatalog` union (`tool-surface.ts:265-277`), which becomes the ledger-derived loaded set;
- the discover-tools thrash paths: the empty-catalog answer (unreachable after offer gating) and `markDiscovered` (the `run-tool-stores` discovered `Ref`, which becomes ledger facts);
- `.withHarness` `lazyDisclosure` / `toolDiscovery` / `toolIndex` and the three env flags, kept one release as deprecated aliases of `disclosure`.

### 12.5 Work breakdown

**Bug fixes now. None of them changes a default wire.**

| # | Owner | Work | Zero-token gate |
|---|---|---|---|
| F1 | runtime-warden (+ owner for `apps/docs`, which has no warden) | B2 truth: `types.ts:157,171-176`, `tools.mdx:16`; wire `getUnlistedToolCount` from the permitted snapshot; dev-log + trace for an unpermitted builtin name | docs-sync check; spike `discover.ts` base arm names the unlisted count |
| F2 | runtime-warden | public `.withTools({disclosure})` mapping onto *today's* internals (`all`→`full`, `index`→`index`, `discover`→`discover`); tier defaults unchanged (`hybrid` stays internal); `run-started.config.disclosure` | builder unit test for precedence; prompt goldens byte-identical with the setting unset |
| F3 | kernel-warden | never-zero floor + `discover-tools` offer gating (`tool-surface.ts`, `tool-capabilities.ts:184-196`) | spike `probe.ts` base arm with a custom tool: ≥1 domain tool on turn-1 wire; no `discover-tools` when permitted − loaded = ∅ |
| F4 | kernel-warden + tools-warden | repair-not-refuse: resolve native names against the *permitted* set and load + execute (`native-fc-strategy.ts:93-144` takes the permitted hint list from the kernel) | scripted call to a pruned permitted tool executes on the same turn and emits `tool-loaded{via:"repair"}`; an unpermitted name is still refused with the hint |
| F5 | cortex-warden | Lab panel + chat quick-control `disclosure` selector (builder parity); disclosure works within Cortex's `allowedNames` | `probe-cortex.ts` with each value |

**Mechanisms that need the ablation first** (spike-before-build; harness-warden runs, ablation-warden judges):

| # | Owner | Mechanism |
|---|---|---|
| M1 | kernel-warden | `index` v2: frozen catalog + loader replaces promotion; deletes `hybrid` |
| M2 | provider-warden | Anthropic `defer_loading` + `tool_reference` from `discover-tools` |
| M3 | kernel-warden | append-only load order, ledger-derived loaded set, `tool-loaded` facts (shared module §12.4, landing with skills step 4) |
| M4 | runtime-warden | tier default changes (e.g. local → `all`, frontier → `index`) |

**Ablation setup:**

- **Bench:** `packages/benchmarks/src/wide-surface-ablation.ts` at 12 / 44 / ~150 tools.
- **Arms:** `all`, today's `index`, M1, `discover`, and M1+M2 (Anthropic only).
- **Tiers:** qwen3:4b + cogito:8b, plus one Anthropic model; n ≥ 5. Gaps under 26pp in solve rate are noise, so the token and cache metrics carry the decision.
- **Metrics:**
  - needed-tool-hidden rate (target ≈ 0);
  - extra load turns;
  - billed tokens;
  - the `cache_read` / `cache_creation` split;
  - solve rate.
- **Decision rule:** any default change must pass the lift rule.
- **Zero-token pre-gates:**
  - M1/M3: the wire `tools` array is a byte-prefix of the next request's array across a load;
  - M2: a request snapshot shows deferred tools flagged and the breakpoint on a non-deferred tool.

### 12.6 Open questions for the owner

1. **Read-only starter set.** Should plain `.withTools()` permit a small read-only builtin set by default (`file-read`, `list-directory`, `web-search`), so that "Read notes.txt" works with no opt-in? This widens default permission. It is a default-on change for the lift rule, and it is the only honest way to get B1's convenience.
2. **OpenAI Responses migration.** Should the OpenAI adapter move to the Responses API so OpenAI gets native deferral like M2? That is a provider-warden project and out of scope here. Without it, OpenAI runs pay a prefix break per load batch.

### 12.7 Advisor record (2026-11-06): GO-WITH-CHANGES

Verified in code: §12.1 file:line claims for index promotion (`tool-index-disclosure.ts:66-76`, `think.ts:650-664`), tier default and guess (`context-profile.ts:160`, `run-envelope-config.ts:42-47`), the post-builtins snapshot (`tool-schemas.ts:139-173`), `getUnlistedToolCount` without a production supplier (`discover-tools.ts:48,113`), offered-surface-only resolution (`native-fc-strategy.ts:93-144`), the false docs claims (`builder/types.ts:171-176`, `tools.mdx:16`), `discoveredFromCatalog` (`tool-surface.ts:265-277`) and `RELEVANCE_FLOOR = 2` all hold. One claim is off: the Anthropic adapter uses top-level automatic `cache_control` (`anthropic.ts:200,316`), not a per-tool breakpoint, so the §12.3 "breakpoint on the last non-deferred tool" line does not describe our adapter.

**Required changes.**

1. **Permission axis has a hole (§12.2).** `tool-schemas.ts:162` adds classifier-relevant builtins to the permitted set without opt-in, so `adaptive: true` widens permission, which contradicts "a mode setting must never widen permission". Either document `adaptive` as a permission widener in F1, or move classifier relevance to the disclosure axis (loads only from the permitted set). Pick one before F1 ships.
2. **M1 reintroduces the failure promotion fixed.** The 2026-08-19 finding (JSDoc, `tool-index-disclosure.ts:50-54`): an index whose entries are not callable scored 0% solved. `index` v2 is safe only if the direct-call repair (F4) works, and on grammar-constrained providers (OpenAI `strict`, llama.cpp tool grammars) a model cannot emit a name outside the `tools` array, so repair never fires there. State the dependency M1 ⇐ F4, add "direct-call-to-cataloged-name rate per provider" to the ablation metrics, and keep `discover-tools` as the guaranteed path.
3. **F3 and F4 do change default wires (§12.5 header).** Offer gating removes `discover-tools` from every mid/frontier run with nothing hidden; F4 lets a previously refused call execute. Both are fixes, but gate them with H3 targeted cells as a smoke check (as §9 does for skills), and scope F4 to native-fc; text-parse already resolves against the universe (`tool-index-disclosure.ts:60-63`).
4. **Reclassify M3 as a refactor with a zero-token gate, ordered before M1/M2.** A ledger-derived loaded set and append-only order change no wire content, only order, and the ablation arms for M1/M2 cannot be built without it. Keep the byte-prefix pre-gate; drop the lift requirement for M3 alone.
5. **Precedence is incomplete (§12.3).** Today `reasoningOptions.harness` and the env flags beat the tier floor (`run-envelope-config.ts` call site). Define one order: `.withTools({disclosure})` > deprecated `.withHarness` switches / env flags > `contextProfile.toolDisclosureMode` > tier, and record the winning source in `run-started.config.disclosure`.
6. **The 2% catalog budget is unusable at local windows.** At `num_ctx` 8192 it is about 160 tokens, under 10 one-line entries, so `index` on local degenerates to `discover` at 12 tools. Set the budget as `max(2% of window, N entries)` or make it tier-scaled, and have the ablation compare the catalog against today's description-stripped promoted schemas (`think.ts` `compactProfile`), which may be cheaper per tool than a one-line catalog entry.
7. **Anthropic plan (§12.3): rewrite the cache note.** Keep automatic top-level `cache_control`; the M2 pre-gate verifies the API accepts it alongside `defer_loading` tools, names the beta header the feature needs, and snapshots a `tool_reference` round trip from the custom `discover-tools` result.
8. **Name the run boundaries.** The permitted set is frozen at bootstrap; MCP tools registered mid-run are out of scope. The loaded set is per run: a spawned sub-agent starts from its own floor, a strategy switch keeps the ledger (and so the loaded set), and `verification-think-retry.ts:69` (`allToolSchemas: []`) must keep offer gating off. Compaction never touches the tools array, so no re-attach is needed.

**Judgment on the questions.** Mode set: keep `all | index | discover`; `index` and `discover` are one mechanism differing only in catalog rendering (names vs count), so implement them as one path with a flag. Keep `index` only as v2; today's index is `all` with short descriptions and should not be offered under that name. B2: agree, for the reason given; plus change 1. Floor, offer gating, monotonic set, batched loads: right-sized; batching is what makes OpenAI Chat Completions tolerable. Cache economics: Anthropic sound with change 7, OpenAI sound, Ollama sound but change 6 decides whether `index` can exist there.

**Minimum first slice.** F1 + F2 together (truth fixes, public setting, `run-started.config.disclosure`), then F3 offer gating with the H3 smoke. F4 next, native-fc only. M3 before any M1/M2 ablation.

**Optional.** Q1 read-only starter set: run as one more arm of the same wide-surface ablation. Q2 Responses migration: defer until M2 shows the cache split moves the bill.

### 12.8 Owner decisions (2026-11-06)

All eight advisor changes in 12.7 are adopted.

**Q1, builtins for plain `.withTools()`: named presets plus a loud notice. No silent starter set.**

- **Presets.** `.withTools({ builtins: "read" | "research" | "workspace" | "all" })` sits next to today's `boolean | string[]`. Each preset is one explicit, auditable word.
  - `"workspace"` grants file read and list only inside the run's workspace root, so the permission follows from what the user declared.
  - The exact members of each preset are fixed in the F2 slice and documented in the JSDoc.
- **Notice.** When `.withTools()` resolves to zero capability tools, the build prints one notice naming the fix. When a model calls a registered builtin that is not opted in, the trace and the dev log name the setting that would enable it.
- **Why.** A silent default breaks the server and multi-tenant story: `file-read` can read `.env`, and `web-search` without a key is a broken tool. Presets fix the newcomer story with one word and change no default, so no lift gate applies.

**Q2, OpenAI Responses API: defer. When built, add it as a second transport, never as a replacement.**

- **Transport.** Responses would be selected automatically for `api.openai.com` and supported models, with an explicit override. Chat Completions stays the path for OpenAI-compatible endpoints (LiteLLM, vLLM, LM Studio, OpenRouter).
- **Triggers to build.** Either one is enough:
  - M2 shows that keeping the cache across tool loads moves the bill;
  - a probe shows that losing reasoning items across turns hurts OpenAI reasoning models.
- Until then, batched append-only loads keep Chat Completions to about 1 or 2 cache breaks per run.
