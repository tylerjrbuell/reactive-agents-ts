---
type: harness-report
status: complete
created: 2026-11-06
tags: [harness, truthfulness, prompts, tool-descriptions, guidance, audit]
---

# Harness truthfulness audit (2026-11-06)

**Question.** Where does text the model sees state something about the run's environment, tools or rules that can be false for the actual run config?

**Answer.** 17 live claims across 20 sites. The top three are bugs that need no measurement to justify fixing:
- **Phantom action requirement.** The contract compiler adds `[action:create-ticket]` / `[action:send-message]` requirements from loose word co-occurrence. It scans injected memory and chat history as well as the task. Every rendered instance in the corpus is false (45/45 runs).
- **"Alternate path" recovery steer.** It names an unrelated tool as a substitute for a failed one ("file-read failed → try file-write"). 56 real-model runs saw it.
- **recall pointers.** Four harness texts tell the model to call `recall(...)` while the recall-overflow gate has removed recall from the wire. 73 real-model runs saw this.

`discover-tools` is still default-on. It was on the wire in 172 real-model runs and called in 11 (6.4%; 5 of those 11 are llama3.2). The Aug 2026 REMOVE verdict was never executed.

## Method

- **Trace corpus.** Every trace JSONL under the job tmp dir, `wiki/Research/Harness-Reports/` and `~/.reactive-agents/traces` (5,960 files). That gives 3,057 unique runs, of which 1,680 are real-model runs (provider/model not `test`/`replay`/unknown). Each `llm-exchange` event records the full `systemPrompt`, `messages[]` and `toolSchemaNames`. Tool *descriptions* are not recorded, so description exposure is counted as "tool on the wire".
- **Census and scan.** `census.ts` gives a normalized line census (which harness lines reach how many runs). `scan.ts` runs 33 conditional checks per run (claim present AND its precondition false in the same exchange). `action-need.ts` replays `detectActionNeed` over all 1,244 distinct tasks. `code-exec.ts` runs the real code-execute handler against its own description.
- **Probes.** Ten zero-token configs with the scripted test provider (`probe.ts`): default, tools, ws-terminal, ws-run, skills, meta, subagents, docs, lean, plan. The probes dump every request (system prompt, messages, tool descriptions and params).
- **Live at HEAD.** Every finding marked live was confirmed by reading the source at HEAD (`dev`, 0edb76dfc). Corpus counts are historical exposure across older SHAs, not a HEAD-only rate.
- **Artifacts.** `/home/tylerbuell/.claude/jobs/eaddf328/tmp/truth-audit/` holds `dumps/*.json`, `census.json`, `runs.json`, `scan.json` and the scripts.

**Instrument caveat.** In probes, the test provider gives the harness-channel tool classifier no text turn, so relevance comes back empty. In the `tools`, `meta`, `docs` and `lean` cases this collapsed the turn-0 surface to `discover-tools` plus config meta-tools, even for "Read notes.txt". That is not representative of a working classifier, so probe surfaces were not used for exposure counts. It still shows a real fallback shape: when classification fails, the model sees no domain tool.

## Ranked findings (live at HEAD)

"Runs" = runs exposed (all / real-model).

| # | Claim the model sees | Anchor | False when | Runs | Sev | Owner | One-line fix | Kind |
|---|---|---|---|---|---|---|---|---|
| 1 | `[action:create-ticket] task requires a "create-ticket" action ("file … bug")` (also send-message, schedule-event) | `packages/reasoning/src/kernel/contract/run-contract.ts:341-344` (rule), `:368-386` (detect), `:500` (fed whole task string) | Verb and object match anywhere in the text, no adjacency. "test **file** … **bug**", memory text "**files** … **issues**", assistant history "**sends** … **message**" all match. Detection also runs over injected `Prior context / Relevant Memory` and `--- Conversation history ---`. | Rendered: 45/45 (all false: 42 debug-green, 3 Cortex). Contract-flagged: 130 runs, about 83 false ("Find the price of xrp" gets create-ticket from memory text). | HIGH | kernel-warden | Detect on the user's own message only. Require the verb to govern the object (same clause, ≤3 tokens apart, imperative position). | Bug |
| 2 | `Recovery required: prior tool path failed (file-read). Try an alternate path now: file-write. Do not finalize yet.` | `packages/reasoning/src/kernel/loop/runner-helpers/recovery-steering.ts:111-114`; pool `:193-227` | The alternate is any not-yet-failed tool (often the next required write tool), not a functional substitute. Seen: file-read→file-write, file-write→code-execute, web-search→file-read, code-execute→file-read. | 56 / 56 | HIGH | kernel-warden | Name an alternate only when it shares the failed tool's capability (read→read, search→fetch). Otherwise use the existing "retry X with corrected arguments" arm. | Bug |
| 3 | `Re-read any section with recall("_tool_result_N", …)`, `Re-read it with recall(…, full: true)`, `retrievable by reference: recall(…)`, `use recall() + manual extraction` | `packages/reasoning/src/assembly/result-store.ts:115`, `assembly/gather-dedup.ts:162`, `assembly/compaction.ts:161`, `kernel/capabilities/act/tool-execution.ts:406`; gate `kernel/capabilities/reason/think.ts:429-431` | The recall-overflow gate (default-on) removes `recall` from the callable set, but these texts render anyway. The gate's marker match and the text's `recallable` flag are separate predicates. | 76 / 73 (control: recall mentioned and visible in 126/126) | MED-HIGH | kernel-warden | Use one predicate: render a recall hint only if recall is callable this iteration. Or make the gate recognize these markers so recall becomes callable. | Bug |
| 4 | `Fix: (1) Verify the model supports function calling for your provider, (2) Simplify the task description … (3) try .withContextProfile({ tier: 'local' })` and `Fix: (1) Add a persona instruction … (2) Use .withReasoning({ defaultStrategy: 'plan-execute-reflect' })` | `packages/reasoning/src/kernel/capabilities/reflect/loop-detector.ts:234-236`, `:264-266`; delivered by `kernel/capabilities/verify/harness-internal-text.ts:50` (strategy-switch handoff `Failure reason:`) | Always. This is developer remediation for builder config, shown to the model after a switch. The model cannot act on it. | 92 / 92 | MED | kernel-warden | Split the loop message: `summary` goes to the model, `devHint` goes to the trace/event only. The handoff renders `summary`. | Bug |
| 5 | File-tool `path` param: "RELATIVE to the working root … Never invent absolute paths … they resolve outside the working root and the call is refused" | `packages/tools/src/skills/file-operations.ts:100-103`, `:255-258`, `:463-465`; root never stated: `packages/reasoning/src/context/context-engine.ts:62-85` (Environment block has date/tz/platform only) | An absolute path inside the root is accepted (errors show `open '/abs/…' (working root: …)`). Tasks routinely give absolute paths. "The working root" is referenced but its value is never shown. | 980 / 964 exposed (file tool on wire + absolute path in task). Harm signal: 18 / 18 runs with ENOENT on a doubled root (model stripped the leading `/` → `<root>/home/…`), plus mangled-user-path refusals (`/home/tyler-butell/…`). | MED | tools-warden (param text); kernel-warden (Environment line) | Param: "relative to the working root, or absolute if inside it". Add `Working root: <path>` to the Environment block when a file root is bound. | Bug (text); lift needs measurement |
| 6 | `[Recovery guidance: file-write failed. Try an alternative approach or use a different tool to get the information you need.]` | `packages/llm-provider/src/adapter.ts:177` (local tier) | The failure is usually bad arguments (validation, ENOENT, enum). "Use a different tool" steers away from the fix. "Get the information" is wrong for write tools. | 271 / 271 (write tools: 69 / 69) | MED | provider-warden | Validation/args/ENOENT errors: "fix X's arguments per the error above and retry X". Drop "get the information" for side-effect tools. | Bug |
| 7 | `Permanently unavailable tools (do not retry — synthesize without them): file-read` and `Tool "X" is permanently unavailable — every call failed. Do not retry it` | `packages/reasoning/src/kernel/capabilities/verify/harness-internal-text.ts:53`; `kernel/loop/runner-helpers/strategy-switch.ts:315` | The condition is "no successful call yet in this run". One wrong-path ENOENT or one web-search with no results qualifies. The tool is available; only the arguments failed. | 12 / 12 | MED | kernel-warden | Render "X failed N× (last error: …)". Reserve "unavailable" for not-registered or policy-denied tools. | Bug |
| 8 | code-execute: "isolated Bun subprocess", "No browser APIs (DOMParser, fetch)", "TypeScript type annotations will cause a syntax error"; cwd never stated | `packages/tools/src/skills/code-execution.ts:72`, `:78`, `:100`; cwd `:218` | Measured on host mode (default): `typeof fetch` = `"function"`; `const x: number = 2` runs (result 4, with and without `language`); `process.cwd()` = `/tmp`, not the workspace; `$HOME` is readable (not isolated). Relative reads and writes from code land in `/tmp`. | 360 real runs on wire, 85 called. Enum rejections `language must be one of` in 62 runs. | MED | tools-warden | Same split as the shell-execute fix: state that cwd is a temp dir (not the workspace), that fetch and TS are available, and say "isolated" only for the docker sandbox. | Bug |
| 9 | discover-tools: "This does NOT list skills — skills are procedural instructions in your system prompt (## Skills section)" | `packages/tools/src/skills/discover-tools.ts:47`, `:137` | No skills are configured, so there is no `## Skills` section. | 478 / 169 (of 172 real runs with the tool on the wire) | LOW-MED | tools-warden | Drop the clause, or render it only when a skill catalog is present. | Bug |
| 10 | `[Already done — do NOT repeat. Give FINAL ANSWER if all steps are complete.]` | `packages/reasoning/src/kernel/capabilities/act/guard.ts:358` | On FC dialects the final answer is plain text. Synthesis prompts in the same corpus say "no `FINAL ANSWER:` prefix" (129 runs). | 168 / 164 | LOW-MED | kernel-warden | "Nothing is outstanding: answer the user now." | Bug |
| 11 | `Your last replies were tool-call text that could not be executed. Do NOT call a tool or write JSON. Answer the task now in plain prose.` | `packages/reasoning/src/kernel/capabilities/reason/unresolved-tool-call.ts:68` | Also fires after a native call to a registered-but-hidden tool (probe `tools`: two file-read calls, then "Do NOT call a tool" on a file-reading task). | 21 / 13 (3 after a native `tool_use`) | LOW-MED | kernel-warden | Distinguish the cases: "X is not callable now; callable: […]" vs malformed text. Never forbid tools while requirements need one. | Bug |
| 12 | find: "loaded with .withDocuments() … agent.ingest() … pass it to relate(id) … check recall()" | `packages/tools/src/skills/find.ts:55-60` | `relate` is opt-in (absent in 10/10 real runs with find). recall is often gated. Builder API names mean nothing to the model. | 12 / 10 | LOW | tools-warden | Render the relate/recall sentences only when those tools are registered. Replace builder API names with "documents loaded for this agent". | Bug |
| 13 | Stall nudge: `do NOT call meta-tools (brief/pulse/find/discover-tools)` | `packages/reasoning/src/kernel/loop/runner-helpers/stall-deliverable.ts:81` | None of those tools are on the wire. | 51 / 51 | LOW | kernel-warden | List only meta-tools present on the surface, or omit. | Bug |
| 14 | Skills: `## Skills (… do NOT call them as tools)` + `use get_skill_section("x", "full")` | `packages/reactive-intelligence/src/skills/skill-resolver.ts:305`; `packages/reasoning/src/assembly/stages/system-prompt.ts:80` | The tool is not registered, and the header forbids calling it anyway. Known from today's skills spike. | 11 / 3 (incl. Cortex) | MED (low volume) | kernel-warden | Covered by the skills-spec work. | Known |
| 15 | shell-execute: "inside a sandboxed /tmp directory … confined to a temporary sandbox under /tmp" | `packages/tools/src/skills/shell-execution.ts:623` | Host/workspace mode: probe `ws-terminal` `ls` returned the workspace's `notes.txt`. | 102 / 98 | HIGH | tools-warden | Being fixed (uncommitted `shell-execute-definition.ts`). | Known, in flight |
| 16 | web-search error: `Optional API keys: TAVILY_API_KEY …, BRAVE_SEARCH_API_KEY …, SERPER_API_KEY …` | `packages/tools/src/skills/web-search.ts:410` | Always. This is operator configuration advice, not something the model can act on. | 18 / 18 | LOW | tools-warden | Send key hints to the error event/log. Give the model "no results; try a different query or source". | Bug |
| 17 | `You have gathered N pieces of information. That is enough. Do NOT search again.` | `packages/llm-provider/src/adapter.ts:184` | "Enough" is asserted from a count, not checked against requirements. | 3 / 3 | LOW | provider-warden | "If the requirements above are covered, call X now." | Bug |

### Already fixed (historical exposure only)

- **Absolute deliverable paths and input files.** `.//abs/path` deliverable ids and input files compiled as write deliverables (`[artifact:.//tmp/…/report.md]`, `write the file .//…/pipeline.json`). 49 + 35 runs exposed historically. Fixed in 8d9d10035 (`anchorDeliverablePath`, `post-conditions.ts:129`).
- **RI redirect nudge.** "Unavailable / final-answer" wording: per the brief, addressed in fa3e33b7b. This audit did not re-verify that text. No `unavailable` string remains in `packages/reactive-intelligence/src/controller`.

### Checked and true (no finding)

- `No tools available for this task.` (`context-engine.ts:125`): 12 runs, every one with zero tools on the wire.
- `Grounding required: no tool call has succeeded yet` (`grounded-terminal.ts:113`): 277 real runs, 1 doubtful.
- Environment date, timezone and platform lines.
- spawn-agent / spawn-agents descriptions.

## discover-tools status

- **Registration.** Default-on. `toolDiscoveryEnabled(defaultValue = true)` (`packages/reasoning/src/harness-flags.ts:63`, env `RA_LAZY_TOOLS`) feeds `h.toolDiscovery`. `packages/reasoning/src/kernel/capabilities/act/tool-capabilities.ts:185-196` then registers it and appends it to the available schemas of every kernel run with tools. That is the exposure path behind the owner's Cortex screenshot.
- **Real-model use.** On the wire in 172 runs, called in 11 (6.4%): llama3.2 5/5, cogito:8b 3/18, gemini-2.5-flash 2/17, gpt-4o 1/13. Zero calls from grok-4/4.3 (26), gemma4 (39), claude haiku/opus (9), gpt-oss (10).
- **History.** The 2026-08-11 vetting judged it pure cost and recommended REMOVE. The 2026-08-19 tool-index counter-proposal (`tool-index-disclosure.ts`) is default-off and has never been ablated. Neither decision was executed.
- **Cost on every exposed run.** One schema of about 90 words. Its description also carries false claim #9.
- **Verdict.** Removal or default-off changes a default, so it needs measurement: one ablation-warden A/B, `toolDiscovery` on vs off, on a lazy-surface suite, ≥2 tiers. It is not a bug fix. The probe fallback shape (classifier fails, domain tools hidden, only discover-tools offered) is the scenario that decides whether the escape hatch earns its schema.

## Reliability correlation (not causal)

- **lh-debug-green.** Phantom `[action:create-ticket]` was rendered as an outstanding requirement in 6/6 lh-a0 runs. Accuracy was 0–33%; terminations were harness_deliverable, harness_synthesis and 4× end_turn. This audit does not attribute the failures. The requirement is `acceptance: "checker"`, so whether it holds the exit gate open needs a targeted rerun after fix #1 (`--task lh-debug-green`, before/after).
- **Abstention risk.** The same detector drives `assessActionSatisfiability` (`packages/reasoning/src/kernel/contract/satisfiability.ts:58-95`). A run without required tools and with no keyword-relevant domain tool abstains at iteration 0 with "missing capability: create-ticket". On Cortex, where memory text matches on almost every message, this is a live false-abstain path. Not measured here.

## Recommended order

1. **#1 phantom action requirement** (kernel-warden). Highest leverage, a clean before/after exists on `lh-debug-green`, and it also removes a false-abstain path.
2. **#2 and #3** (kernel-warden). Both are steering text that points at the wrong tool or an uncallable one.
3. **#4, #7, #10, #11, #13** (kernel-warden). One "harness text truth" pass. They are all text-only and share the handoff/guidance renderers.
4. **#5, #8, #9, #12, #16** (tools-warden). Description truth, following today's shell-execute pattern (definition derived from the handler's actual config).
5. **#6, #17** (provider-warden). Local-tier adapter texts.
6. **discover-tools default** (ablation-warden). Measurement, not a fix.

One rule would prevent this class from recurring: a claim about a tool, path or capability is rendered only from the same resolved value the handler or surface uses (the shell-execute definition seam), never from a static string.
