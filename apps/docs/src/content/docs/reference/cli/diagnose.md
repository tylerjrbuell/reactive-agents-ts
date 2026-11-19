---
title: rax diagnose
description: Forensic CLI for recorded JSONL traces - list, replay, grep, diff, debrief, signals, cause and attribute subcommands.
topic: cli
related:
  - reference/cli
  - concepts/decision-tracing
  - features/snapshot-replay
  - guides/troubleshooting
---

Forensic CLI for recorded JSONL traces. Part of the [CLI reference](/reference/cli/). Subcommands:

```bash
rax diagnose list [--limit 20]              # show recent traces
rax diagnose replay <runId> [--raw|--json]  # pretty-print trace timeline
rax diagnose replay-run <runId> [--json]    # recorded-run metadata (replay() API input)
rax diagnose grep <runId> "<js-expr>"       # filter events with a JS predicate
rax diagnose diff <runIdA> <runIdB>         # structural diff between two runs
rax diagnose debrief <runId> [--json]       # decision timeline with rationale
rax diagnose signals <runId> [--json]       # harness signals never rendered / ignored / contradicted
rax diagnose cause <runId|path> [--json]    # why the run ended as it did (deterministic cause + evidence)
rax diagnose cause --all [dir] [--real]     # tally causes across a directory of traces
rax diagnose attribute <runId|path> [--json]  # is it the harness or the model? (verdict, reason, divergence turn)
rax diagnose attribute --all [dir] [--real]   # tally attributions across a directory of traces
```

## Try it without a key

From the next release (0.19.0), `@reactive-agents/diagnose` ships one real recorded failed run (qwen2.5-coder:14b via Ollama, an experimental opt-in configuration). You need no API key, no model and no run of your own:

```bash
npm install @reactive-agents/diagnose
npx rax-diagnose cause node_modules/@reactive-agents/diagnose/examples/failed-run.jsonl
npx rax-diagnose attribute node_modules/@reactive-agents/diagnose/examples/failed-run.jsonl
```

Expected output (key lines; evidence lines omitted):

```text
01M4ZTZAAEMD217GE6Z8SM2A4W: cause=never-engaged confidence=decisive status=failure
  ...
  attribution harness (harness:contradictory-guidance) confidence=decisive
01M4ZTZAAEMD217GE6Z8SM2A4W: harness (harness:contradictory-guidance) confidence=decisive target=sales-q1.txt
```

The model never called the tool it needed. The request told it to call `file-write` but offered no tool schemas, so the harness, not the model, is at fault.

## Subcommands

**`cause`** classifies a finished run from trace events only (never model text) with ordered, first-match-wins rules. It prints the cause, a confidence, the supporting events (`eventKind#seq`) and `missing`: the trace signals whose absence kept the verdict from being decisive. Confidence is `decisive` (read from authoritative signals), `probable` (fallback fields or heuristics; `missing` says what would upgrade it) or `insufficient-trace` (cause `undetermined`; the trace is too thin and the classifier does not guess). Causes: `direct-chat` (a trace holding only `llm-exchange` events, the direct chat path: not a run, skipped by the cohort tally), `timeout` / `user-stop` / `aborted` (from `run-aborted.reason`; an abort with no reason is classified from its error tag as `aborted/guardrail-block`, `aborted/contract-violation`, `aborted/kill-switch` or `aborted/<causeClass>`; `incomplete-trace` means only a trace with neither `run-completed` nor `run-aborted`), `provider-error` (sub-class from `outcome.errorClass`, text regex as legacy fallback), `satisfiability-abstain`, `terminal-mislabel` (includes `run-completed.status` contradicting `outcome.success`/`outcome.status`), `plan-posture-veto`, `never-engaged`, `tool-protocol`, `tool-failure`, `wrong-tool-arg`, `stall-after-work`, `stall-no-progress`, `loop-after-work`, `bookkeeping-loop`, `verifier-reject`, `budget-cap` (sub-causes `token-budget`, `cost-budget`, `token-and-cost-budget`, `spend-budget` for spend limits; iteration caps keep their own), `unexplained` (a residual, never a finding), `success-with-warning` (a success whose verifier check failed or whose deliverable was accepted via `advisory-softfail`; states the fact, does not claim the answer is wrong), and `none` (healthy run). `--all` recurses a directory (default: the trace directories above), skips `llm-direct.jsonl`, and tallies cause by outcome status; `--real` drops synthetic (`test` provider) traces. The same result is on `RunAnalysis.cause` from `@reactive-agents/trace` (`analyzeCause(trace)`). `cause --json` also carries an `attribution` field (see `attribute` below).

**`attribute`** answers the next question about a failed run: is it your harness configuration or the model? It reads the recorded trace only (zero tokens) and works on any trace written by the trace recorder (`.withTracing()` or `.withObservability({ tracing: { dir } })`), with or without a grader verdict. A run counts as failed when `run-completed.status` is not `success`, `outcome.success` is false, or an `eval-graded` event failed; an abstention the grader accepts is `not-failed`. It finds the **divergence turn** (the `llm-exchange` whose output produced the failing file or final answer: from grader check names, else the contract or `outcome.outstanding` deliverables, else the run's writes), checks whether each tool result the run had obtained was in that turn's projected request, and checks what the harness did around it. Output: `verdict` (`harness` / `model` / `environment` / `unattributed` / `not-failed`), `reason`, `confidence` (`decisive` / `probable` / `insufficient-trace`), `divergenceTurn {iter, seq}`, `evidence` (`eventKind#seq` + detail), `missing` (the signals that would make it decisive) and `alsoMatched` (other reasons that also fired). Reasons, first match wins:

| Reason | What the trace shows |
|---|---|
| `harness:false-veto` | The grader passed but the run was marked failed (ground truth wins: this precedes `model:fabrication-vetoed`, so a verifier veto on a grader-passed run reads as a false veto); or (no grader) an outstanding deliverable is a template placeholder such as `out-N.txt` that matching writes already satisfy (`probable`). |
| `harness:honest-decline-mislabeled` | The run failed without ending in an abstention, every real tool call failed, and the final text is an honest decline: it admits it cannot, names why (the file or tool is unreachable), and reports no number the failing tools did not print. The stop path labelled correct behavior a failure, so the run is not an `environment:tool-failure`. |
| `model:fabrication-vetoed` | The run's terminal verifier refused the model's own answer for invented numbers or entities (`output-not-fabricated-*`) and no grader passed the run. A grader that passed only part of the task does not make that veto false when the grader failed. |
| `harness:tool-surface` | A contract-required tool had a `hidden:` reason on `tool-surface-resolved`. |
| `harness:tool-not-offered` | The model asked for a tool (a native call, or a JSON call printed in its text) that the request it answered did not offer, the tool never ran, and the run failed. Fires only when that turn offered no domain tool, or the trace shows the tool exists for the run (offered on another turn, on `tool-surface-resolved`, or required by the contract); a bare empty wire is `probable`. |
| `harness:contradictory-guidance` | The run's last LLM turn was a `think` turn whose request told the model to call a run tool but offered no schema for it; the model named that tool and it never ran. |
| `harness:subpass-abstained` | A kernel pass abstained before its first LLM call (`terminal_decision` with 0 LLM calls) and the run kept going on top of it, for example a plan step held to a required tool it could not see. |
| `harness:tool-call-dropped` | The model emitted a native tool call (for the graded file, or a resource the run never reached) and no `tool-call-start/end` followed before the next turn. |
| `harness:refusal-counted-as-repeat` | The repetition guard replaced a first call on a target (its count included calls that never ran): the write of a failing file whose content the failed check named, or the read of a task-listed input that then was never read. Any other replaced write of a failing file matches last, as `probable`: the trace cannot show its content would have passed. |
| `harness:refused-repairable` | A write boundary refused the content the model wrote for a failing file (`Refusing to write findings.json: the content is not valid JSON ...`), no later write of that path succeeded, and a content-preserving repair parses the refused content: stray quotes inside strings escaped (only backslashes inserted) or surplus closing brackets dropped. The harness could have saved the file. |
| `harness:misleading-refusal` | The same refusal, no repair parses the content, and the refusal carried a hint that contradicts its own fix (`Malformed JSON in arguments` on a content refusal whose arguments parsed; recorded before `dc7d9eb80`). |
| `model:invalid-content` | The same refusal, correct and actionable, and no repair parses the content. `probable` when the trace did not keep the refused content. |
| `harness:unrepaired-content` | The last successful write of a failing prose file (`.md`, `.markdown`, `.txt`, `.rst`, `.csv`) is one line holding at least two literal `\n` and no real newline (the model sent `\\n` in its arguments), and the write boundary saved it as is. Unescaping `\n`, `\r\n` and `\t` restores the lines, so the harness could have saved the file (same owner rule as `harness:refused-repairable`). Always `probable`: the trace cannot regrade the repaired text. |
| `harness:tool-call-corrupted` | A call the harness parsed from printed text reached the tool with object-literal source in a path-like argument (`{ path: "..." }` inside the path), failed, and that tool never succeeded before the divergence turn. |
| `harness:plan-fanout-blob` | A failing file holds content (40+ chars) that no native model call wrote to it, and the same content was written verbatim to another file: one step result fanned out into several files (plan-execute `{{from_step:...}}`). |
| `harness:premature-stop` | A harness stop (`dispatcher-early-stop`, `harness_synthesis`, a cap, ...) shipped an answer from a turn that predates the run's evidence; or cut a run whose file deliverable was unwritten while evidence was still growing with no repeated calls (`probable` when fewer than 2 iterations of budget were left). |
| `harness:completeness-blind` | The run ended on its own (no harness stop, no abstention, nothing outstanding) while files the grader required were never written, and the harness never knew they were required: neither the compiled contract nor any requirement the run ledger declared later covers them. The fix is a completeness signal (the contract), not the model's prompt. |
| `harness:offer-accepted-as-done` | The run ended on the model's own turn (no harness stop, no abstention) and the end of the shipped output offers to continue the work (`Would you like me to proceed with ...?`) instead of claiming done. `probable` without an `exit_gate` accept record. |
| `harness:evidence-withheld` | The model asked to read a task-listed input, the tool gate refused the read (or a guard notice replaced it), and the input was never read before the divergence turn. Needs a failed `eval-graded` event; `probable` when no failed check or target ties to the input. |
| `harness:evidence-truncated` | The divergence turn's request carried only a compressed preview of a tool result (`...N more lines`), or a projection/curator drop removed it, and containment does not clear the cut. **Containment:** when the content that turn delivered (its writes, or the answer) holds URLs and each one is either visible in the request or in no recorded tool result (miscopied or recalled), the cut hid nothing the deliverable used and the rule does not fire. Always `probable`: the trace keeps only the preview of a compressed result, so it cannot show the failed check needed the cut part. |
| `harness:evidence-missing` | A tool result the run obtained is absent from the divergence turn's request and no drop is recorded, and containment (above) does not clear it. `probable` when the recorder clipped the request (messages are capped at 2,000 chars). |
| `harness:misleading-guidance` | A typed guidance signal steered to a tool that was already satisfied, the model followed it, and the deliverable stayed unwritten. A retry steer naming a tool whose own last call failed does not count. |
| `harness:forcing-unused` | `model:ignored-guidance` or `model:evidence-not-gathered` matched, but the stalled turns offered domain tool schemas (native FC) and made no call, the harness forced none of them although act-or-answer was on (`run-started.config` records `true` or `"proactive"`; an opt-in lever that was off or unrecorded keeps the model label), and those unforced stalls are at least half of the completed tool-offered turns up to the divergence turn. Forcing that fired and still failed keeps the model label. Always decisive; the model reason lands in `alsoMatched`. |
| `model:ignored-guidance` | A typed guidance signal told the model to call an unsatisfied required tool and the next turn did not (`probable` when it printed the call as text instead). |
| `model:evidence-not-gathered` | The divergence turn produced the failing output while a task-listed input had not been read, and nothing stopped the read. Needs a failed `eval-graded` event; `probable` when no failed check or target ties to the unread input. |
| `model:had-evidence-wrong-output` | Every tool result the run obtained was in the divergence turn's request, or containment cleared the cut ones (`probable`: text the deliverable lacks is not in the trace), and the grader still failed the output. Needs an `eval-graded` event. |
| (failure cause) | No rule above fired: the reason comes from the run's failure cause (the same classifier as `cause`), mapped to one owner and reported `probable`, with the cause in `from-cause`. `harness:{terminal-mislabel, plan-posture-veto, stall-after-work, loop-after-work}`, `model:{never-engaged, tool-protocol, wrong-tool-arg, stall-no-progress, bookkeeping-loop}`, `environment:{run-aborted, provider-error, budget-cap, tool-failure}`. Causes the trace cannot settle (a verifier reject, a satisfiability abstain, a wrong answer with no evidence check, an incomplete trace) stay `unattributed`. The map is `CAUSE_ATTRIBUTION` in `@reactive-agents/trace`. |
| `unattributed` | No rule could prove a side and the failure cause has no owner; `missing` names the signal that would. |

`environment` failures are outside both the harness and the model: a provider fault, an abort or timeout, your declared budget, or a tool that itself failed. A tool that refuses the content the model gave it is not an environment fault (see the three refusal reasons above; a write it accepted unrepaired is `harness:unrepaired-content`). Without a grader, `model:had-evidence-wrong-output` cannot fire (the trace alone cannot say an answer is wrong); such runs report `unattributed` or `not-failed`. Append a deterministic grade to your trace as an `eval-graded` event to get it. `--all` recurses a directory and prints counts by verdict and reason.

Both modes also list the **mechanisms that acted** in each run, so you can check that a harness change you are testing actually ran: guards that did not pass (`guard:<guard>:<outcome>`), injected harness signals (`signal:<kind>@<origin>`), strategy switches (`strategy-switch:<from>-><to>`) and contract requirements by source (`requirement:<kind>@<source>`, with `declared-mid-run` for requirements added after compile). Single-run mode prints them on an `activity` line (`activity` array in `--json`); `--all` prints how many runs each key appeared in. Programmatic API: `attributeFailure(trace)`, `mechanismActivity(trace)` and `compareActivity(before, after)` from `@reactive-agents/trace`.

Run IDs accept a bare ULID (resolves under `~/.reactive-agents/traces/`), an absolute path to a `.jsonl` file, or the literal `latest`. Override the trace directory with `REACTIVE_AGENTS_TRACE_DIR`.

Export a run's raw trace by id: `rax diagnose replay <runId> --raw > run.jsonl` (prints the recorded JSONL verbatim).

**Trace retention.** Traces are classified by provenance from the run's first event: a `test` provider/model is *synthetic*, everything else (including unknown) is *real*. Synthetic traces are pruned aggressively (older than `RA_TRACE_SYNTHETIC_MAX_AGE_HOURS`, default 24, or beyond `RA_TRACE_SYNTHETIC_MAX_FILES`, default 200). Real traces are deleted only when both older than `RA_TRACE_REAL_MAX_AGE_DAYS` (default 90) and outside the newest `RA_TRACE_REAL_MIN_RUNS` (default 500), or beyond a `RA_TRACE_REAL_MAX_BYTES` size cap (default 4 GiB, oldest first, never inside the protected newest runs). Files modified in the last 10 minutes are never deleted. Under `bun test`, default tracing is redirected to a per-process temp dir so tests never write to your real corpus.

Snapshot/Replay re-execution is API-only — see [Snapshot & Replay](/features/snapshot-replay/) for the `replay(recordedRun, builderFn)` workflow.

The standalone bin `rax-diagnose <sub>` is kept for backwards compatibility; new code should prefer the unified `rax diagnose <sub>` form.
