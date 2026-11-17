---
type: experiment
status: complete
created: 2026-11-17
tags: [skills, learning, spike, traces, phase-0, harness-warden]
---

# Skill learning loop, Phase 0 spike: do recurring, extractable failure->recovery pairs exist?

Gate for `wiki/Architecture/Design-Specs/2026-11-16-skill-learning-loop.md`. Zero tokens, read-only. Miner: `wiki/Experiments/2026-11-17-skill-learning-phase0/mine-pairs.ts` (raw JSONL parse of the trace files, same format `loadTrace` reads). Outputs beside it: `results.json` (all tables), `pairs.jsonl` (every failure episode, 563 rows).

## Verdict: RE-SCOPE (narrow GO for evidence/miner only; no distiller yet)

Pairs are not sparse: 351 usable recoveries in 170 real runs. They recur. But the recurring ones are almost all tool-surface faults (bad enum value, missing required arg, sandbox allowlist, unknown todo action) that a schema, error message, healing stage or config fix removes at the source. Procedural, task-level knowledge ("how to do X in order") barely shows up. One model (mimo-v2.6) supplies 70% of the pairs. The spec's skill premise (skills distilled from pairs) is not supported by this corpus as it stands; a narrower "tool-usage note" premise is.

## Method (deterministic rules)

- Source: `~/.reactive-agents/traces/*.jsonl` (3,744 files). `./.reactive-agents/traces` does not exist (0 files).
- Event: `tool-call-end` (toolName, ok, args, error), ordered by `seq` per run. Model/provider/task from `run-started`.
- Failure episode: `ok:false`. Consecutive identical (tool,args) failures collapse to one episode.
- Recovery, same run, scanning the next 6 calls:
  - `same-tool-changed-args`: next ok call of the same tool with different args. Fix shape = per-key change (`+k` added, `-k` removed, `~k` value changed, `~k:type` type changed).
  - `same-tool-same-args`: transient retry (not a skill).
  - `different-tool`: first ok call of another non-meta tool. Weak: often means the model gave up on the tool, not that it fixed anything.
  - `none`: no ok call in window.
- Error class: regex buckets (arg-validation, denied, duplicate, unknown-action-enum, not-found, transient-network, parse, missing-arg), else normalised first line.
- Tier from model name (heuristic): test-fixture / local / mid / large / frontier. Task type: keyword buckets on the task text (crude).
- Recurrence: same (tool, error class, recovery+shape) in >=3 distinct runs. Also checked >=2 distinct task prefixes (bench tasks repeat, so run count alone inflates).

## Counts

| Measure | Value |
|---|---|
| Trace files | 3,744 |
| Test-fixture traces (`model: test`/`test-model`, no signal) | 2,438 |
| Real-model traces | 1,306 |
| Traces with any tool call | 811 |
| Real traces with >=1 failed tool call | 238 |
| Failure episodes | 563 |
| Recovered: same-tool-changed-args | 202 (126 runs) |
| Recovered: different-tool (weak) | 149 (70 runs) |
| Retry same args | 2 |
| Never recovered in window | 210 |
| Usable recoveries (first two rows) | 351 in 170 runs |

Of the 202 same-tool-changed-args pairs, 40 fail with empty args `{}` (model quirk, fix is "fill the required arg").

Per tier (failure episodes): mid 400, large 85, frontier 51, local 27. Usable: mid 269, large 39, frontier 33, local 10. Tier is dominated by mimo-v2.6 (360 of 563 episodes; 245 of 351 usable), then bonsai-2:27b 75, gemini-2.5-flash 27, qwen3.5 19. Cross-tier "small vs frontier" comparison is not supportable: local-tier n=10.

Per task type (usable): crypto-price 116, web-research 63, file-code 55, analytics-mcp 52, other 52, shell 12, math 1.

Per tool (usable): umami/get_website_metrics 75, shell-execute 73, todo 47, spawn-agent 29, web-search 25, crypto-price 16, file-read 12, umami/get_website_traffic 10, list-directory 7, grep 7.

Error class (all episodes): arg-validation 192, denied 67, duplicate 50, unknown-action-enum 44, shell-sandbox message 43, transient-network 34, not-found 28. 263 of 351 usable pairs (75%) are in the arg-validation / denied / duplicate / unknown-action / shell-sandbox group.

## Recurrence (>=3 runs, same tool + error class + fix shape)

Strict list (all >=2 distinct tasks too):

| Tool | Error class | Fix shape | Runs | Tasks | Models |
|---|---|---|---|---|---|
| shell-execute | sandbox "Command X not in allowed list" | same tool, `~command` | 19 | 10 | 6 |
| shell-execute | denied (path outside sandbox) | same tool, `~command` | 18 | 12 | 4 |
| umami/get_website_metrics | arg-validation | switched to another umami tool (weak) | 10 | 7 | 2 |
| shell-execute | arg-validation (empty command) | `+command` | 10 | 6 | 1 |
| web-search | arg-validation (empty args) | `+query,+maxResults` | 10 | 10 | 1 |
| todo | unknown-action-enum | `~action,~items` | 9 | 6 | 2 |
| umami/get_website_metrics | arg-validation (`type` enum) | `~type` | 8 | 6 | 2 |
| web-search | arg-validation | `+query` | 7 | 6 | 1 |
| crypto-price | arg-validation (empty args) | `+coins(,+currency)` | 4 | 4 | 1 |
| crypto-price | denied (approval, no handler) | ->web-search (weak) | 4 | 4 | 1 |
| umami/get_website_traffic | arg-validation | `~unit` | 3 | 2 | 1 |
| shell-execute | duplicate | `~command` | 3 | 3 | 1 |
| file-read / list-directory | arg-validation/not-found | `~path` | 3 each | 3 | 1-2 |

Loose key (tool + error class only): 19 groups reach >=3 runs. So recurrence exists, and 8 of the strict rows cross >=2 models. Caveat: recurrence of the SHAPE ("a key changed") is thin evidence; the fix content (which value) differs per run and is not extractable by rule.

## 10+ hand-read examples (first pair per recurring key; not a random sample)

Class: S = skill-worthy, C = config/harness-fixable, Q = model quirk.

| # | Model (tier) | Tool, error, fix | Class |
|---|---|---|---|
| 1 | grok-4 (frontier) | shell-execute `ls -la /tmp` -> "outside the sandbox"; retry `ls -la` | C: sandbox message already tells the answer |
| 2 | grok-4 (frontier) | shell-execute `... \|\| echo ...` -> "echo not in allowed list (gws, gh, curl, rax, ls, cd)"; retry `ls` | C: allowlist is config; surface it in the tool description, not a skill |
| 3 | bonsai-2:27b (large) | umami get_website_metrics `type:"pageviews"` -> enum error; model abandoned, called get_events | S (weak): tool-usage knowledge ("valid `type` values"), though the MCP schema lists them. Fix = schema/prompt surfacing |
| 4 | mimo (mid) | web-search `{}` -> missing "query"; retry with query | Q: empty-args |
| 5 | cogito:14b (mid) | todo `action:"get_crypto_prices"` -> unknown action, closest valid call shown; retry `add` | C: already guarded; model conflates todo with a tool |
| 6 | mimo (mid) | crypto-price `{}` -> missing "coins"; retry `{coins:[BTC],currency:USD}` | Q: empty-args (same class as #4) |
| 7 | mimo (mid) | crypto-price blocked: "requires approval, no approval handler configured"; model fell back to web-search | C: run config; not a model skill at all |
| 8 | mimo (mid) | file-read `/home/user/...CHANGELOG.md` -> path traversal outside working root; retry with real root | Q (hallucinated root); C: path-heal stage candidate |
| 9 | bonsai-2:27b (large) | spawn-agent timed out at 120s; model switched to umami/get_website_daterange | C/environment: timeout, not skill |
| 10 | qwen3:4b (local) | file-read `.../apps/cortex/apps/cortex/README.md` ENOENT (doubled path); retry correct path | Q: path-root confusion; C: healing candidate |
| 11 | mimo (mid) | grep path `/root/../../` -> traversal; model switched to file-read AGENTS.md | Q |
| 12 | gpt-oss-120b (large) | list-directory `./downloads` ENOENT; retry `.` | Q: cwd awareness |

Tally: skill-worthy 1 (weak), config/harness-fixable 5, model quirk 6. No example is a multi-step procedure a skill would encode. The shell-execute empty-args family belongs to a harness guard, as the brief anticipated.

## Context: `rax-diagnose attribute --all` (3,662 runs, 544 failed)

Verdicts: harness 63 (12%), model 71 (13%), environment 220 (40%), unattributed 190 (35%). Harness reasons: tool-not-offered 21, tool-call-dropped 13, loop-after-work 10, stall-after-work 9, terminal-mislabel 4, evidence-truncated 4, evidence-missing 2. Model reasons: never-engaged 25, fabrication-vetoed 17, bookkeeping-loop 11, wrong-tool-arg 11, tool-protocol 7. Most failed runs are environment (run-aborted 133, provider-error 64): irrelevant to skill content. Run failures are mostly not tool-arg failures, so pair-mining covers only a thin slice of the failure surface (wrong-tool-arg is 11 runs, and note most tool failures are recovered mid-run and the run still succeeds).

## Existing sources (read-only)

- ExperienceStore (`experience_error_recoveries`, `experience_tool_patterns`): scanned every `~/.reactive-agents/memory/**/memory.db`. Exactly ONE db has the tables; it holds 2 tool-pattern rows and 0 error-recovery rows. The store the spec calls "tool-param level experience" is empty in practice. Corroborates that no live accumulation of pairs happens today.
- Cortex `cortex.db` tool rows: `~/.cortex/cortex.db` 19 runs, 48 ToolCallCompleted; `reactive-agents-ts/apps/cortex/.cortex/cortex.db` 10 runs, 40 ToolCallCompleted (39 with a failure marker in the payload, a loose match, not validated); `~/.reactive-agents/cortex.db` is a 0-byte file. About 88 rows total, all overlapping with traces by run id. Adds no new pairs.

## Limits and instrument caveats

- Tier and task-type are heuristic; mimo-v2.6 is 64% of episodes, so recurrence across models is weak (the cross-model column above is the honest signal).
- "different-tool" recoveries are not fixes (abandonment). Treat the same-tool-changed-args count (202) as the cleaner figure.
- Many traces are bench reruns of identical tasks; the tasks column mitigates but does not remove that.
- Window = 6 calls, regex classes are mine; not validated against a hand-labelled set beyond the 12 above. Quirk/config/skill labels are one reviewer's judgement.

## Recommended phase-1 scope (replaces spec phases 1-3 ordering)

1. Build only the evidence layer: `ExperienceEvidence` + a `rax-diagnose pairs` miner (the script here is the prototype). Value is immediate as harness telemetry: it ranks recurring tool-surface faults.
2. Re-key the unit from "skill" to "tool-usage note" (tool, error class, corrected shape), and first route the recurrences to their owners: shell-execute allowlist/empty-command guard, todo action hint, web-search/crypto-price empty-args guard, path-heal for rooted-path errors, approval default (tools warden / runtime warden). These are cheaper than any distiller.
3. Hold the distiller (spec Stage 2) and tier-variant work until a corpus exists where recurring pairs remain after those fixes, and until ExperienceStore actually accumulates (currently 0 rows). Re-run this miner after the guards land; if recurrence persists on non-schema pairs, reconsider.
4. Spec Stage 4 (tier distillation) has no evidence base: local-tier n=10, no same-task small-vs-frontier pairs.

Frontier-vs-small tier comparison would need a deliberately collected corpus (same tasks, 2+ tiers); do not infer it from this one.
