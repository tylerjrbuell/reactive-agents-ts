---
type: harness-report
status: complete
created: 2026-11-06
tags: [harness, tool-surface, builtins, discover-tools, spike, instrument-first]
---

# Tool-surface hiding spike (2026-11-06)

**Question.** When a run has tools but no `requiredTools` (the normal Cortex / SDK case), how often is a builtin the task needs, such as `file-read` on "Read notes.txt", missing from the model's surface? What does the model do then, per tier?

**Short answer.**
1. **The premise is wrong. The tool-relevance classifier is not the cause.** It is opt-in (`classifier.ts:122-132`) and makes no call in a default run. The ablation-warden dumps record no classifier request, only `think`. The tool is dropped by the **builtins opt-in default** (`tool-schemas.ts:139-165`): `withTools({})` puts zero builtins in the schema.
2. **The documented escape hatch is gone.** Docs say unopted builtins stay "callable by name, and discoverable via the `discover-tools` meta-tool" (`apps/docs/.../guides/tools.mdx:16`, `builder/types.ts:171-176`). At HEAD both claims are false:
   - The discovery and index catalog is `exposedToolSchemas`, snapshotted *after* the builtins filter (`tool-schemas.ts:173`, F9 2026-07-28, `execution-engine.ts:376,403`). So `discover-tools` answers **"No tools registered."** (`discover-tools.ts:88-89`) while 12 domain builtins are registered (`builtins:true` wire lists them).
   - The local-tier tool index has nothing to list.
   - A native call by name is resolved against the offered surface and comes back `unresolved`.
3. **The model is never told the tool is unavailable.** The resolver builds an unavailable-name hint (`native-fc-strategy.ts:140`). The kernel stores it only in `state.steps` (`dispatch-think-response.ts:526-529`). With no required tools there is no `pendingGuidance` (`:596-598`), so the hint never reaches the wire. That is verified on 3 traces and every probe arm. After 2 strikes the tools are withheld and the model is told "Answer the task now in plain prose." Real models then claim the action was done.
4. **Real-run frequency is low.** Every high-volume real caller bypasses the default:
   - Cortex always sends an `allowedNames` list.
   - H3 and bench always declare `builtins` / `requiredTools`.

   The exposed population is SDK users of plain `.withTools()`. In the corpus: **2 harmed runs of 2 builtin-naming runs, both local. 0 on API tiers** (no exposed API run named a builtin).

## 1. Selection path (file:line)

| Stage | Where | Default-run behavior |
|---|---|---|
| Classifier gate | `packages/runtime/src/engine/phases/agent-loop/setup/classifier.ts:122-132` | Off unless `withTools({adaptive:true})` / `requiredTools.adaptive`. No LLM call. |
| Classifier failure | same file `:191-215` | Catch → `{required:[], relevant:[]}` = no filtering, so **no builtin is added**. Same surface as default. |
| Builtins opt-in filter | `.../setup/tool-schemas.ts:139-165` | `builtins` unset ⇒ all `BUILTIN_TOOL_NAMES` dropped unless allowed / required / classifier-relevant. |
| Discovery/index catalog | `.../setup/tool-schemas.ts:173,293-297` → `packages/runtime/src/execution-engine.ts:376,403,428` | Snapshotted **after** the builtins filter, so dropped builtins are undiscoverable. |
| Disclosure floor | `packages/runtime/src/engine/run-envelope-config.ts:42-47`; `packages/reasoning/src/context/context-profile.ts:160` | Local tier `index` mode (no `discover-tools` on wire unless `RA_TOOL_DISCOVERY=1`). Mid/frontier offer `discover-tools`. |
| Index promotion | `packages/reasoning/src/kernel/capabilities/reason/think.ts:650-664`; universe `kernel/policy/run-posture.ts:104-107` | Promotes from `toolSurface.universe`, which never contained the builtin. |
| Native call to off-surface name | `packages/tools/src/tool-calling/native-fc-strategy.ts:93-144` | `thinking` + `reason: unresolved-tool-call` + hint text. |
| Hint delivery | `packages/reasoning/src/kernel/capabilities/reason/dispatch-think-response.ts:474-481,526-529,588-598` | Hint goes to `steps` only. Strike 1: nothing reaches the model. Strike 2: tools withheld, "answer in prose" (`unresolved-tool-call.ts:67-69,161-162`). |

Trace blind spot: `tool-surface-resolved.reasons` lists only the post-builtins universe. A builtin dropped by the opt-in leaves **no reason entry**, so the trace cannot show it was hidden. Only its absence is visible.

## 2. Instrument check

Scripts: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/surface-spike/{probe.ts,discover.ts}`. Dumps are in `dumps/`. All runs used the scripted LLM (`withReplayLLM`, zero tokens). The task in every arm was "Read notes.txt and tell me what it says." Each arm scripts `file-read` then an answer. `packages/reasoning` resolves from `dist`, built 09:38:02, 19 s before HEAD's reasoning commit `0fe2bb661`.

| Arm | local (ollama qwen3:4b) wire | mid (test) wire | frontier profile (anthropic haiku, scripted) wire | file-read executed |
|---|---|---|---|---|
| `withTools({})` (base) | `[recall]` | `[discover-tools]` | `[discover-tools]` | no |
| `builtins:["file-read"]` | `[file-read, recall]` | `[file-read, discover-tools]` | same | yes, success |
| `adaptive:true`, classifier says relevant `file-read` | `[file-read, recall]` | `[file-read, discover-tools]` | same | yes, success |
| `adaptive:true`, classifier returns empty | `[recall]` | `[discover-tools]` | `[discover-tools]` | no |
| `adaptive:true`, classifier fails (unparseable ×2) | `[recall]` | n/a | n/a | no |
| base + model calls `discover-tools{query:"read file"}` | `RA_TOOL_DISCOVERY=1`: result **"No tools registered."** | **"No tools registered."** | n/a | no |
| `builtins:["file-read"]` + discover call | n/a | "Top 1 TOOLS … file-read(path…)" | n/a | yes |

The instrument verdict has two parts:
- The ablation-warden's guess was "the classifier returned nothing only because the scripted model answered nothing". That guess does not apply: no classifier runs by default.
- The hiding is deterministic and does not depend on the model. Scripted `TestLLMService` emits the toolCall whether or not the tool is offered. That is a correct stand-in for a real model calling an unoffered name.

`discover-tools` with a non-empty catalog works at HEAD (last row), so its "No tools registered." in the base arm is the empty catalog, not a broken tool.

## 3. Real traces

Scanner: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/surface-spike/scan.py`, run with `python3 -I scan.py <dir> [--recursive] --json rows.json`.
- **Included:** root runs with an agent loop.
- **Excluded:** test provider, Cortex utility calls (titles, summaries, judges), and this spike's own probe task.
- **"Needs":** taken from the *current user message* only. The scanner matches a named file path read/write, a URL fetch, "search the web", or "run code".

Corpora:
- `~/.reactive-agents/traces`: 3027 files, 268 qualifying runs.
- `apps/examples/.reactive-agents/traces`: 6 runs.
- `wiki/Research/Harness-Reports/**`: 248 runs, mostly bench, with builtins / required declared.

| Population (home corpus) | local | api |
|---|---|---|
| Qualifying runs | 148 | 120 |
| No `requiredTools` | 143 | 120 |
| …and no allowlist and `builtins` unset (exposed to this defect) | 67 | 26 |
| …of those, turn-1 surface had **zero domain tools** | 14 | 5 |
| …of those, the task needed a builtin | **2** | **0** |
| Harmed (needed tool never offered) | **2/2** | 0 |
| Recovered by index promotion / discovery | **0** | n/a |

Harmed runs (both `ollama/qwen3.5:latest`, origin `user`, 2026-11-04). Both were agent probes from this job, not end users:
- `01M6JEVEK40AW79DKZJ7HSPCAT`: "Fetch https://example.com with http-get and tell me the page title." Wire was `[recall]`. The model wrote a `bash http-get` block in prose, then **made up** "the page title is **Example Domain**". The run reported **success**: `end_turn`, verifier "10 checks passed", grounding off.
- `01M6JEXWPTSQJSXWRDB3C0S5YE`: "Write a file …/notes.txt containing three facts". Wire was `[recall]`. The model printed a JSON `file-write` call as text. Reasoning switched to plan-execute-reflect, the give-up gate fired, and the run failed with `abstained`. No file was written.

The same "model not told" defect, reached through other hiding causes:
- `01M6FMFJGN717FFX7RSZH40WDV` (gemma4:e4b, Cortex, 2026-11-02, allowlist without file-write). "Save BTC price to btc.txt". The model called native `write_file` twice. No hint reached it (verified: iter-2 request has no mention). Tools were withheld, and the model answered "**I have completed the task by saving this price to a file**". Status failure (artifact check).
- `apps/examples` `01M0K0WR45YTMMV6KANPX0H7E2` + 2 siblings (gemma4, 2026-08-21, custom halopedia tools). Lazy disclosure narrowed 7 tools to 1 at iter 1. The model called the dropped `halopedia-get-page`, and the tool was re-offered at iter 2. All three succeeded. This is pre-HEAD, so it is noted only.

Not this defect (excluded after inspection):
- Cortex runs whose allowlist lacked the tool (`not-allowed`, the user's tool selection).
- Plan-posture withholding (`hidden: withheld by plan posture`, deliberate).
- 3 llama3.2 plan-execute runs, which have no kernel surface event (scanner false positive).
- The S3 "146 × No tools registered" thrash (`01M4SXNTN38VM8ZQ0Q85A7FA3E`, 2026-10-13). It had file-read/file-write visible, so its empty catalog was a different, historical cause. At HEAD, discovery works with builtins opted in.

### Instrument faults found (my package, `packages/diagnose`)

| Run | `rax-diagnose` says | Truth |
|---|---|---|
| `01M6JEXWPTSQJSXWRDB3C0S5YE` | `model (model:tool-protocol)` probable | `file-write` was never on the permitted surface. This is a harness surface cause, not model protocol, and it over-blames the model. |
| `01M6JEVEK40AW79DKZJ7HSPCAT` | `cause=none`, not-failed | The model claims a fetch result with zero tool calls on a URL-fetch task. This is a fabricated success. |
| `01M6FMFJGN717FFX7RSZH40WDV` | `harness:tool-call-dropped` decisive | Harness side is right. The precise cause is "named tool off the permitted surface, and the model got no unavailable feedback". |

## 4. Ranking and fix candidates

The volume of real harm is small: 2 runs, local only, both probes. The defects are deterministic, so every plain-`.withTools()` user who asks for a file or URL hits them. The weightier problem is the **false claims**: the docs, plus `discover-tools` telling the model no tools exist. One fix per cycle, in this order:

| # | Fix (smallest form) | Owner | Anchor |
|---|---|---|---|
| A | **Make the hint reach the model.** On `unresolved-tool-call` from an off-surface native name, put the unavailable-name hint into `pendingGuidance` (`errorRecovery`), the same channel the required-tools nudge uses. Today it is steps-only. This is general: it covers builtins, allowlists and lazy disclosure. | kernel-warden | `packages/reasoning/src/kernel/capabilities/reason/dispatch-think-response.ts:526-529,588-598` |
| B | **Restore or retract the documented escape hatch. This is an owner decision.** (B1) When `builtins` is *unset*, put the registered builtins in the discovery/index catalog but keep them off the prompt. F9's narrowing stays for an explicit `builtins:[subset]`, which is a stated restriction. Security question: B1 would make `code-execute` discoverable by default. (B2) Keep strict no-builtins and fix the false docs/JSDoc. | runtime-warden (B1); docs via owner of `apps/docs` (B2) | `packages/runtime/src/engine/phases/agent-loop/setup/tool-schemas.ts:160-173`; `packages/runtime/src/builder/types.ts:171-176`; `apps/docs/src/content/docs/guides/tools.mdx:16` |
| C | **Stop the lying empty catalog.** "No tools registered." is false when tools are registered but not permitted. Say "No additional tools are available in this run". Do not offer `discover-tools` when the catalog has nothing beyond the visible set: it is pure cost, and it is the known thrash shape. | tools-warden (message); kernel-warden (offer gating) | `packages/tools/src/skills/discover-tools.ts:88-89` |
| D | **Attribution:** check the permitted surface before blaming `model:tool-protocol`, and flag "claims a tool action with zero tool calls". | harness-warden (own package, pending approval) | `packages/diagnose` attribute rules |

**Not recommended:** "never hide a builtin named in the task text". That adds a keyword heuristic in front of a deliberate opt-in default. A or B fixes the real gap without guessing intent.

**Verify plan (after the fix):** re-run `probe.ts` and `discover.ts`, both arms, on `ollama qwen3:4b`, `test`, and the `anthropic` profile. Then run a live 2-tier check (qwen3:4b, cogito:8b, k≥3) on 3 no-required tasks: read a file, fetch a URL, write a file. Measure success and fabricated-claim rate before and after.
