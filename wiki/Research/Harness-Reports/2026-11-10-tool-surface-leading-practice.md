---
type: research
status: active
created: 2026-11-10
tags: [tools, meta-tools, harness, tool-surface, small-models]
---

# Built-in and meta tools: what leading practice says, and what it means for RA

Question (owner, 2026-11-10): how should our built-in and meta tools change so every model tier solves problems well in our harness? Fold `grep` into `shell-execute`? Fold `list-directory` into `file-read`? How should meta tools merge?

Owner decisions already made: `crypto-price` stays for now. `discover-tools` stays (it is the progressive-disclosure mechanism). The gh/git/gws CLI wrappers are folded into scoped `shell-execute` (done 2026-11-10).

## 1. What the evidence says

| # | Finding | Source | Strength |
|---|---|---|---|
| E1 | Function-calling accuracy drops as the number of visible tools grows; every model peaks at small toolsets; parameter count does not predict it. | Linköping thesis; "Less is More" (arXiv 2411.15399) | Medium (thesis + edge-device paper) |
| E2 | An adaptive shortlist (~7 tools shown) matches the coverage of showing 50, and raised Sonnet 4.6 tool-selection accuracy 87.1% to 93.1% (60.9% to 76.8% on medium queries). | arXiv 2605.24660 | Medium (one preprint) |
| E3 | Interface quality beats tool count. SWE-agent's largest ablation drop came from removing the edit tool's lint guardrail (reject invalid edit, show the error, ask again). Search that listed only matching files beat search with more context; an iterative "find next" search did worse than no search tool. | SWE-agent (arXiv 2405.15793), ACI docs | Strong (peer-reviewed ablation) |
| E4 | Errors should teach recovery: say the expected format and give an example. Consolidate related operations into a few high-impact tools. Default pagination/truncation. Tool descriptions are the biggest single factor. | Anthropic, "Writing effective tools for agents" (2025-09) | Strong (practitioner, eval-backed) |
| E5 | For frontier models, bash alone scores at or above bash + typed tools and typed-tools-only, with fewer calls and tokens. Typed tools are the recommendation only when execution cannot be isolated. | "Is Bash All You Need?" (arXiv 2609.11999; Opus-4.8, GPT-5.5) | Medium (preprint, frontier only) |
| E6 | Small models are where bash-only weakens; with explicit schemas and validators, small models match larger ones at function calling. | SLM agent survey (arXiv 2510.03847); mini-SWE-agent notes | Weak to medium |
| E7 | Keep the tool list stable during a run; mask unavailable tools instead of removing them (cache and model confusion). Recitation (todo.md) keeps goals in attention, but Manus measured ~33% of actions spent updating it and moved planning out. Codex made `update_plan` opt-in. | Manus context-engineering post (secondary write-ups); Codex CLI notes | Medium |
| E8 | Worked usage examples in tool definitions raise accuracy (reported 72% to 90%, not confirmed in primary text). | Anthropic, "Advanced tool use" | Weak (number unverified) |
| E9 | A `think` tool helps in policy-heavy, sequential tool use (tau-bench airline +54% relative) and does little elsewhere. | Anthropic, "The think tool" | Strong for its niche |

Reference harnesses: Codex CLI runs on `shell` + `apply_patch` (+ opt-in `update_plan`). Claude Code keeps purpose-named tools (Read, Edit, Write, Glob, Grep, Bash, ...); Read on a directory is an error, and discovery goes through Glob/LS.

## 2. Principles for RA

1. **Fewest tools, each named by intent.** The model picks by name first (E1, E4). One tool per verb the model thinks in: read, write, edit, search, list, run.
2. **Remove the trap at the tool, before the model hits it.** A guardrail that rejects or heals a bad call with a teaching message is worth more than a new tool (E3, E4). Canonical home: `arg-healing.ts` and each tool's handler, not kernel nudges.
3. **Results answer in one call.** Concise, salient-first, paginated (E3, E4). Done for record previews and `find` on 2026-11-10.
4. **Computed state is pushed, not pulled.** If the harness can compute it (iteration, tokens, pending required tools, readiness), render it in `Guidance:` each turn rather than offer a tool to ask for it (Golden Rule 5, E7). Pull tools stay only for detail on demand.
5. **Stable list per run, shortlist by relevance.** Progressive disclosure via `discover-tools` matches E2. Within one run, do not add or drop tools; refuse with a message instead (E7). Changing tools between runs or chat turns is the user's choice and stays allowed. Goal of the whole initiative (owner, 2026-11-10): speed, efficiency, reliability and task performance. Check `think-prune` / `tool-gating` against this.
6. **Tier-aware, not tier-specific.** Typed tools with validators are the default (helps small models, E6). `shell-execute` stays opt-in; frontier models with a shell get most value from it (E5). One surface, no per-model forks.

## 3. Decisions

### grep: keep as its own tool

`grep` is pure `node:fs`, root-confined, output-capped, excludes `node_modules`/`.git`/`dist`, and works with no shell and on Windows. The CLI-wrapper fold rationale (external binary, wrapper confusion) does not apply. Folding it would remove code search from every agent without `terminal: true`. Improve it instead:
- Literal fallback: if the pattern fails to compile, or has regex metacharacters and matches nothing, retry it as a literal and say so in the result.
- `filesOnly` output mode (file list with counts), which SWE-agent found best for search (E3).

### list-directory: keep the tool, heal the trap in file-read

Would models find directory listing inside `file-read`? Not reliably. Models choose by tool name and the first line of the description; a second mode hidden in another tool's description is found by frontier models and missed by small ones (E1, E4, E6). No leading harness merges them: Claude Code errors on Read of a directory, SWE-agent has separate find/search tools.

Better: get the benefit without the discovery cost.
- `file-read` on a directory returns the listing with a one-line note (`path is a directory; listing shown`), instead of the raw `EISDIR` error it gives today (no directory handling in `file-operations.ts`). The model that guesses wrong still gets its answer.
- `list-directory` gains a `glob` / `recursive` option, so it also finds files by name. Nothing covers that today.

Net tool count unchanged; one trap removed, one capability added.

### Meta tools: merge by intent

Registry names today: `final-answer`, `task-complete`, `context-status`, `brief`, `pulse`, `todo`, `find`, `recall`, `checkpoint`, `scratchpad-write`, `scratchpad-read`, `relate`, `activate-skill`, `get-skill-section`, `rag-search`, `discover-tools`, `request-user-input`.

| Intent | Tool | Absorbs | How |
|---|---|---|---|
| Know where I stand | `brief` (detail on demand) | `pulse`, `context-status` | Iteration, tokens, pending required tools and readiness render in `Guidance:` every turn. `brief` keeps the full environment view. `pulse`'s readiness oracle moves harness-side. |
| Keep my notes | `recall` | `checkpoint`, `scratchpad-*`, `relate` | Every recall entry survives compaction (that is all `checkpoint` adds). Scratchpad aliases deleted. `relate` becomes `recall({key, linkTo})`, or leaves the default surface if uptake is zero. |
| Look something up | `find` | `rag-search` | `find` already searches loaded documents. |
| Follow a plan | `todo` | — | Harness renders the open checklist in `Guidance:` so the model does not spend calls re-reading it (E7). |
| Learn a skill | `activate-skill` | `get-skill-section` | `activate-skill` already takes `file`. |
| Get more tools | `discover-tools` | — | Kept (owner). |
| Ask the human | `request-user-input` | — | Kept. |
| Finish | `final-answer` | `task-complete` | One terminal tool. |

About 17 names become 8. Old names stay as deprecated aliases that resolve to the new tool with a warning (the pattern used for the CLI fold).

## 4. Trap census (do first)

"Prevent traps before the agent hits them" needs a list of traps ranked by frequency. Zero-token spike before any build ([[feedback_spike_before_build]]):
1. Over recorded runs, count per tool: calls, failures, failure class (bad args, empty args, wrong tool for the job, unknown tool, error then same call repeated).
2. Count meta-tool uptake per tier: tools with near-zero uptake leave the default surface; tools called in loops get a push-not-pull fix.
3. Rank the trap classes; fix the top ones at the tool boundary.

`.reactive-agents/traces/*.jsonl` returned 0 calls for every tool on 2026-11-10; the census must first locate the recorded runs (H3 run artifacts, Cortex DB).

Known traps already fixed on 2026-11-10: doubled CLI root, record previews hiding results, name-only `find` queries. Known open: Ollama empty args (upstream), run ending on an intention, `file-read` on a directory, regex metacharacters in `grep`.

### Census results (2026-11-10)

Corpus: `~/.reactive-agents/traces/*.jsonl`, 3,111 files, 501 non-test runs with tool events (frontier 78, groq 70, xai 42, local ≤14B 197, other local 113), 1,349 tool calls. Script: scratchpad `tool-census.ts` (reads `tool-call-end`, `tool-surface-resolved`, `run-started`). Mostly Cortex and scratch runs, not H3.

- **Failure rate 9.3%** (126 calls). Worst: `shell-execute` 33% (127 calls), `code-execute` 63% (8), `spawn-agent` 60% (10, all timeouts at 120 s), `file-read` 21% (39), `list-directory` 13%.
- **Wrong tool name, 100% fail (19 calls):** `umami_get_website_stats` for `umami/get_website_stats` (11 tools), `web_search` for `web-search`. Fix: separator- and case-insensitive name resolution at the ToolService boundary.
- **shell-execute refusals the model could not predict:** `find`, `pwd`, `bun` not in a custom allow-list; `$(...)` and trailing `&` refused; an absolute `/tmp` path outside the sandbox. The error text lists the allow-list twice when presets and config overlap.
- **file-read traps:** raw `EISDIR` on a directory; root `…/apps/cortex` + path `apps/cortex/README.md` resolving to `apps/cortex/apps/cortex/README.md`; encoding `utf-16le` rejected.
- **todo invented actions:** `clear`, `create_list`.
- **Wrong recovery hints:** the `&` refusal ("escapes the timeout") got "shell-execute timed out" from the adapter `errorRecovery`; file-edit's "oldText was not found" got "call list-directory" from `getRecoveryHint`. Two hint layers stack on errors that already explain the fix.
- **Correction (ablation, 2026-11-10, `wiki/Research/Ablations/2026-11-10-stable-tool-list-ablation.md`):** the figures below read `tool-surface-resolved.visible`, which is not the wire list. With `toolIndex` on, hidden tools are shipped too (about 40 schemas shipped vs 11 visible on one task), and on native FC `final-answer` is not in the wire `tools` array. Measured on `wire-request.toolsShipped`: grok-4's shipped list never changed within a run (0/69); mimo's changed in 37/44 runs at 16k and 10/10 at 8k (`recall` added or dropped). The stable list removed those changes but gave no measurable gain and cost +28-32% billed tokens on grok-4, so it stays opt-in. Treat the 40% number as an upper bound on visible-list churn, not wire churn.
- **Tool list changes within a single run in 40% of runs** (339/853 runs with surface events, all traces incl. test-provider; 286/459 non-test). Each trace file holds exactly one run, so a user changing tools between Cortex chat turns is not counted (that is allowed and expected). Within-run causes: a meta tool shown once its floor condition holds (523, e.g. `recall` after the first tool runs), a permitted tool shown (198), `recall` hidden by the recall-overflow gate (111), a lazily disclosed tool hidden again (87). 27 calls went to a tool never in that run's visible list. Every change rewrites the tool block at the head of the prompt, which invalidates the provider prompt cache (cost and latency) and conflicts with principle 5.
- **Uptake (runs visible / runs called):** `web-search` 272/128, `crypto-price` 152/78, `todo` 369/59, `discover-tools` 144/29, `shell-execute` 117/64, `recall` 188/13, `file-read` 85/24, `file-edit` 71/5, `grep` 76/2, `code-execute` 59/3, `find` 42/5, `brief` 30/1, `final-answer` not measurable.
- **Instrument gap:** `final-answer` is handled inline and emits no `tool-call-end`, so 0 calls appear despite 3,125 `final_answer` terminations. Meta-tool uptake must be read from the terminal reason until it emits.

Repeated identical failing calls were rare (9), so error text is mostly being read. The problems are wrong guesses that the tool could have absorbed, and hints that point the wrong way.

## 5. Gaps: capabilities agents and builders expect

Verified against the code on 2026-11-10 unless marked.

**Built-in tool capability**

| Gap | Today | Proposed | Leverage |
|---|---|---|---|
| Readable web pages | `http-get` returns raw HTML (`http-client.ts`), so scripts and nav fill the capped body before the content | `text/html` → readable text/markdown with title and links; raw on request | High: `web-search` is the most-called tool and its follow-up fetch gets markup |
| Large files | `file-read` has only `path`, `encoding`; large files get truncated | optional `offset`/`limit` line range, line numbers, total line count in the result | High for coding agents |
| Find files by name | `list-directory` is one level, no glob; `grep` searches contents | `recursive` + `glob` on `list-directory` | Medium |
| Several edits in one file | `file-edit` takes one `oldText`/`newText` | optional `edits: [{oldText,newText}]`, applied all-or-nothing | Medium (fewer calls, no half-applied edits) |
| Long-running processes | trailing `&` refused; no way to start a dev server or watcher and read it later | opt-in background process: start, read output, stop | Medium; builders of coding agents expect it |
| Sub-agent time budget | `spawn-agent` uses a fixed 120 s tool timeout (`agent-tool-adapter.ts`); 60% timed out in the census | timeout follows the sub-agent's own budget; return partial result on timeout | Medium |
| Keyless web search | DuckDuckGo instant answers return nothing for ordinary queries (census sample) | a keyless fallback that returns real result lists (unverified which source is reliable) | Medium for users without API keys |
| PDFs and images | `file-read` reads text only | text extraction for PDF; image passthrough for vision models | Medium (modality-neutral principle) |

**Harness**

| Gap | Proposed |
|---|---|
| Tool list changes mid-run (62% of runs) | Keep the list stable for the run; refuse calls that are not ready yet with a message saying when they will work |
| Two recovery-hint layers (`getRecoveryHint` in reasoning, `errorRecovery` in the provider adapter) | One canonical recovery layer, fed by a structured error class from the tool rather than substring matching |
| No usage examples on tool definitions (`ToolDefinition` has no `examples` field) | Optional `examples` rendered for small models (E8); MCP tools inherit the server's descriptions, so this is the main lever on their argument mistakes (`recipient: "user"`) |
| `final-answer` and other inline meta tools emit no tool events | Emit `tool-call-start/end` for inline meta tools so uptake and failures are measurable |
| Meta tools overlap (section 3) | Merge by intent, behind the ablation gate |

Not yet checked: per-tool pre/post hooks and argument-pattern permission rules for builders (`requireApprovalFor` and guardrails cover part of this), and whether truncated results (223 `result-truncated` events) can be retrieved in full later.

## 6. Stable tool list design (owner, 2026-11-10)

The mid-run changes exist for a reason: they keep the model from calling a tool before it is relevant or possible. The design keeps that protection and moves it out of the tool block.

1. **Choose the tool list once, at run start.** Relevance (task, required tools, tier, disclosure mode) is known before the first call, so the shortlist is fixed there.
2. **Not ready yet → refuse at call time, not hide.** A tool whose precondition does not hold answers immediately, without running, with what to do first (e.g. `recall` with no saved notes: "Nothing saved yet. Save a note with recall(key, content)."). The guard is deterministic and costs one short observation. Preconditions are declared on the tool, so the rule lives in one place.
3. **Steering goes in `Guidance:`, at the end of the prompt.** "Don't use X yet" is per-turn text after the cache prefix, not a change to the tool block.
4. **Discovery is append-only.** `discover-tools` adds tools; nothing is removed during a run. One cache miss per discovery, not one per iteration.
5. **Prompt order:** system prompt and tool block first and static; dynamic content last, so the provider cache prefix survives every turn.

Open: 179 removals carry no reason in `tool-surface-resolved`; find their source before the change.

Measure: within-run changes go to 0 except discovery; prompt-cache hit rate, latency, tokens and task success on 2+ tiers through the ablation gate.

## 7. Case: open-ended task never finishes (folded in, owner 2026-11-10)

Run `01M73FK911EPZWMJAGSFZ7FPNB` (Cortex, `mimo-v2.6`, `num_ctx` 8192, ~20 umami MCP tools), task "Help me explore analytics for my docs site in umami". 3 of 3 tool-using runs of this task failed (`max_iterations` once, `harness_deliverable` twice).

1. "Explore" has no stopping point. 18 calls over 8 iterations, duplicate gathers flagged at iteration 5, no answer written.
2. The tool block and results filled the 8k window (prompt 3.2k → 7.8k). The head-truncation guard dropped tools mid-run twice and compacted history.
3. A thinking runaway, then `low_delta_guard` ended the run; the harness wrote the answer from the gathered evidence. That answer was good.
4. It was then graded a failure: `output-is-model-authored` escalated, the runtime verifier's NLI relevance scored it 0.02, and `run-completed` carried `status: failure` with the answer in `error`.

Fixes (shared terminal substrate, Pitfall 12):
- A harness-written answer from real evidence ends as `partial`, with the answer as output, not `error`.
- When gathering plateaus (duplicate gathers, low delta), the model gets a synthesis turn to write its own answer while there is still room in the window.
- A cheap relevance score (NLI) cannot fail a run on its own.
- The stable tool list (section 6) and on-demand MCP disclosure leave room in small windows.

## 8. Gate

Merging meta tools changes defaults, so it goes through the ablation gate on 2+ tiers with `disclosure-ablation.ts`, printing the visible tool list per arm before reading tokens ([[feedback_tool_surface_confound]]). Trap fixes inside a single tool (EISDIR listing, grep literal fallback, error messages) are pure robustness and need unit tests only.

## Sources

- Anthropic, Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, Advanced tool use: https://anthropic.com/engineering/advanced-tool-use
- Anthropic, The "think" tool: https://www.anthropic.com/engineering/claude-think-tool
- SWE-agent ACI: https://princeton-nlp.github.io/SWE-agent/background/aci , https://arxiv.org/pdf/2405.15793.pdf
- Is Bash All You Need?: https://arxiv.org/abs/2609.11999
- How Many Tools Should an LLM Agent See?: https://arxiv.org/abs/2605.24660
- Small Language Models for Agentic Systems (survey): https://arxiv.org/pdf/2510.03847
- Linköping thesis on tool count: https://liu.diva-portal.org/smash/get/diva2:2072520/FULLTEXT01.pdf
- Manus context engineering (secondary): https://tianpan.co/blog/2026-03-02-context-engineering-lessons-from-manus
- Codex CLI tool surface (secondary): https://codex.danielvaughan.com/2026/06/03/codex-cli-built-in-tool-surface-complete-reference-shell-file-search-image-multi-agent/
- Mini-SWE-agent (secondary): https://www.emergentmind.com/topics/mini-swe-agent-mswea
