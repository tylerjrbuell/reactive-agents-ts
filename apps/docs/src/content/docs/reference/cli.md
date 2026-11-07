---
title: CLI Reference
description: 'Command reference for Rax, the CLI for Reactive Agents.'
---

`rax` is the artisan command line for Reactive Agents.

`Rax` stands for **Reactive Agents Executable**.
Think of it as the Reactive Agents equivalent of Laravel's Artisan CLI.

Use it to scaffold projects, generate agents, run and stream tasks, inspect runtime state, serve A2A endpoints, and deploy across local and cloud targets.

For workflow-first onboarding, start with [Rax CLI](/guides/cli-artisan/).

## Commands

### `rax init`

Create a new Reactive Agents project.

```bash
rax init <name> [--template minimal|with-tools|streaming|with-structured-output|with-approval-gates|with-memory|cloudflare-worker]
```

**Templates:**

`rax init` delegates to the `create-reactive-agent` template engine. All templates install the single unified `reactive-agents` package — no need to install individual `@reactive-agents/*` packages separately.

| Template                  | What's scaffolded                                                          |
|---------------------------|----------------------------------------------------------------------------|
| `minimal` (default)       | `reactive-agents` + single-file agent. No tools. Best starting point.       |
| `with-tools`              | Agent with built-in tools (web-search, http-get, file I/O, code-execute)    |
| `streaming`               | Token-by-token streaming via `agent.runStream()`                            |
| `with-structured-output`  | Typed structured output - declare a schema, read `result.object`            |
| `with-approval-gates`     | Human-in-the-loop - pause on sensitive tool calls for approval              |
| `with-memory`             | Cross-session memory (SQLite) - the agent remembers across runs             |
| `cloudflare-worker`       | Deployable Cloudflare Worker (edge) agent on OpenAI, with wrangler config   |

Generated `src/index.ts` imports from `"reactive-agents"` and is runnable immediately after `bun install && cp .env.example .env`.

### `rax create agent`

Generate an agent file from a recipe, or use `--interactive` for guided scaffolding.

```bash
rax create agent <name> [--recipe basic|researcher|coder|orchestrator]
rax create agent <name> --interactive
```

**Recipes:**

| Recipe | What It Generates |
|--------|------------------|
| `basic` | Minimal agent with LLM only |
| `researcher` | Agent with memory + reasoning |
| `coder` | Agent optimized for code tasks |
| `orchestrator` | Multi-agent orchestrator with memory |

**Interactive mode:**

The `--interactive` flag launches a readline-based wizard (TTY only) that prompts for:

1. **Agent name** — defaults to the first positional argument if you pass one (e.g. `rax create agent my-agent --interactive`).
2. **Provider** — one of `anthropic`, `openai`, `gemini`, `groq`, `xai`, or `ollama` (same set the wizard validates today).
3. **Recipe** — `basic`, `researcher`, `coder`, or `orchestrator`.
4. **Features** — comma-separated list; default `reasoning,tools`. This is collected for the session; the **generated file is determined only by the recipe** (templates live in `apps/cli/src/generators/agent-generator.ts`). Adjust `.withProvider()`, `.withModel()`, and builder flags in the generated source after scaffolding if you need a different stack.

```bash
$ rax create agent my-agent --interactive

Create Agent (Interactive)
? Agent name: my-research-agent
? Provider [anthropic/openai/gemini/groq/xai/ollama]: anthropic
? Recipe [basic/researcher/coder/orchestrator]: researcher
? Features (comma-separated) (reasoning,tools): reasoning,tools

✔ Created: src/agents/my-research-agent.ts
```

### `rax run`

Run an agent with a prompt.

```bash
rax run <prompt> [--provider anthropic|openai|gemini|groq|xai|ollama|litellm|test]
          [--model <model>] [--name <name>] [--tools] [--reasoning] [--stream] [--cortex]
```

**`--cortex`:** Enables `.withCortex()` on the builder so run lifecycle events are sent to a local **Cortex** companion studio (WebSocket ingest). Cortex is available as a public npm package (`@reactive-agents/cortex`). For npm-installed CLI: `bun add @reactive-agents/cortex && rax cortex`. For repo contributors: `bun cortex` (runs from source with hot reload). Set `CORTEX_URL` to the HTTP base (default `http://127.0.0.1:4321`).

**Example:**

```bash
rax run "Explain quantum computing" --provider anthropic --model claude-sonnet-4-6
```

### `rax demo`

Run the live demo with the first detected provider: local Ollama, then an
Anthropic, OpenAI, or Google API key. Google Gemini is selected as the `gemini`
provider. If no provider is configured, Rax displays the recorded example
output instead.

```bash
rax demo
```

### `rax examples`

Run the offline-capable example suite or launch a standalone demo.

```bash
rax examples suite [--offline] [--filter <category>] [<numbers>...]
rax examples list
rax examples demo <name> [--provider <provider>] [--model <model>] [--port <port>]
```

- `suite --offline` runs examples that need no provider credentials. `--filter` selects a category; numeric arguments run selected numbered examples.
- `list` prints available standalone demos.
- `demo island-sim` starts the survival simulation UI. `--provider`, `--model`, and `--port` pass through to demos that support them.

```bash
rax examples suite --offline
rax examples demo island-sim --provider ollama --model cogito:14b --port 3007
```

See the [Examples Catalog](/guides/examples/) for the runnable examples and demos.

### Cortex (companion studio)

Cortex is available as a public npm package and from source. 

**From npm (recommended for users):**
```bash
bun add @reactive-agents/cortex
rax cortex
# Opens http://127.0.0.1:4321 in your browser
```

**From source (for contributors with hot reload):**
```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts
cd reactive-agents-ts
bun install
bun cortex
# API on http://localhost:4321 — UI on http://localhost:5173 (hot reload)
```

Then in another terminal:

```bash
rax run "Research topic" --cortex --provider anthropic
```

| Variable | Purpose |
|----------|---------|
| `CORTEX_PORT` | API listen port (default `4321`) |
| `CORTEX_HOST` | Listen address (default `127.0.0.1`; same as `rax cortex --host <addr>`). Any other address exposes Cortex, which has no authentication, to the network |
| `CORTEX_NO_OPEN` | Set to `1` to skip opening a browser |
| `CORTEX_URL` | Base URL the agent uses to reach Cortex ingest |

### `rax serve`

Start an agent as an A2A server.

```bash
rax serve [--port <number>] [--name <name>] [--provider <provider>] [--model <model>]
          [--with-tools] [--with-reasoning] [--with-memory]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | `3000` | HTTP port for the A2A server |
| `--name` | `"agent"` | Agent name (used in Agent Card) |
| `--provider` | `"test"` | LLM provider |
| `--model` | — | Model name |
| `--with-tools` | off | Enable built-in tools on the A2A server agent (file-write, web-search, etc.) |
| `--with-reasoning` | off | Enable reasoning strategies |
| `--with-memory` | off | Enable memory. With no extra token: default tier (`.withMemory()`). Pass `enhanced` or `2` immediately after the flag for full four-layer memory with embeddings (`.withMemory({ tier: "enhanced" })`). Optional `basic` or `1` after the flag keeps the default tier and consumes that token (same behavior as omitting it). |

**Endpoints served:**

- `GET /.well-known/agent.json` — Agent Card (A2A discovery)
- `GET /agent/card` — Agent Card (fallback)
- `POST /` — JSON-RPC 2.0 (`message/send`, `tasks/get`, `tasks/cancel`, `agent/card`)

**Example:**

```bash
rax serve --name researcher --provider anthropic --model claude-sonnet-4-6 --with-tools --port 4000
```

### `rax discover`

Fetch and display the Agent Card from a remote A2A-compatible agent server.

```bash
rax discover <url>
```

Fetches `GET <url>/.well-known/agent.json` and pretty-prints the agent's name, description, capabilities, and supported skills.

**Example:**

```bash
rax discover http://localhost:3000
```

```
Agent Card: researcher
  Provider: anthropic (claude-sonnet-4-6)
  Capabilities: streaming, tools
  Skills: web-search, file-write
  Endpoint: http://localhost:3000
```

### `rax deploy`

Deploy an agent using a provider adapter (local Docker, Fly.io, Railway, Render, Cloud Run, DigitalOcean).

```bash
rax deploy up [--target local|fly|railway|render|cloudrun|digitalocean]
              [--mode daemon|sdk]
              [--dry-run]
              [--scaffold-only]
              [--name <agent-name>]

rax deploy down [--target <target>]
rax deploy status [--target <target>]
rax deploy logs [-f] [--target <target>]
rax deploy init   # legacy alias for `deploy up --scaffold-only`
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--target` | `local` (auto-detected if config exists) | Deploy provider adapter |
| `--mode` | `daemon` | `daemon` for full agent loop, `sdk` for HTTP API mode |
| `--dry-run` | off | Run provider `preflight()` checks and print execution plan |
| `--scaffold-only` | off | Generate config files only, do not deploy |
| `--name` | auto-detected from `package.json` | Agent/app identifier |
| `--follow`, `-f` | off | Follow logs for `deploy logs` |

**Provider CLI Contracts:**

These commands and flags are validated by `apps/cli/tests/cli-contracts.test.ts` to detect upstream CLI breaking changes early.

| Provider | CLI | Contract Baseline |
|----------|-----|-------------------|
| local | Docker + Compose | Docker `>= 20`, Compose `>= 2`, supports `compose build/up/down/ps/logs`, `up -d`, `logs --tail/--follow`, `ps --format` |
| fly | `flyctl` / `fly` | supports `auth whoami`, `launch --copy-config --name --no-deploy`, `deploy`, `status`, `logs`, `apps destroy --yes` |
| railway | `railway` | supports `whoami`, `link`, `up`, `down --yes`, `status`, `logs`, `variables` |
| render | `render` | supports `blueprint launch`, `services list` |
| cloudrun | `gcloud` | SDK `>= 380`, supports `config get-value project`, `auth list --filter --format`, `run deploy --source --region --port --memory --timeout --allow-unauthenticated`, `run services describe/delete/update` |
| digitalocean | `doctl` | `>= 1.72`, supports `account get --format --no-header`, `apps create/list/update/delete/logs`, `--spec`, `--format` |

**Containerized CLI fallback:**

For `flyctl`, `gcloud`, and `doctl`, `rax deploy` resolves local binaries first and can fall back to a Docker-wrapped CLI when Docker is available.

**Contract test commands:**

```bash
bun test apps/cli/tests/cli-contracts.test.ts
RUN_SLOW_TESTS=1 bun test apps/cli/tests/cli-contracts.test.ts
```

`RUN_SLOW_TESTS=1` enables container image availability checks for the fallback images.

### `rax dev`

Run your local entrypoint in watch mode.

```bash
rax dev [--entry src/index.ts] [--no-watch]
```

Default entrypoint is `src/index.ts`. Use `--entry` if your project uses a different file.

### `rax eval`

Run an evaluation suite from a YAML/JSON dataset file. Uses `@reactive-agents/eval` with frozen-judge isolation (Rule 4) — the judge LLM is wired through a separate `JudgeLLMService` Tag so its code path is isolated from the SUT.

```bash
rax eval run --suite <path-to-suite> [--provider anthropic|openai|test] [--agent <name>]
```

Options:

- `--suite <path>` — required. Path to the suite definition file.
- `--provider <name>` — `anthropic`, `openai`, or `test` (default: `test`)
- `--agent <name>` — agent config name to load from your project (default: `default`)

The runtime guard rejects identical `judge.model === sutModel` pairings to prevent self-judging bias.

### `rax playground`

Launch an interactive agent REPL session.

```bash
rax playground [--provider <provider>] [--model <model>] [--tools] [--reasoning] [--stream]
```

Use `/help` and `/exit` inside the session.

### `rax inspect`

Inspect local deployment/runtime signals for an `agentId`.

```bash
rax inspect <agent-id> [--logs-tail 200] [--json]
```

This checks Docker/Compose availability, prints compose status, and scans recent logs for lines containing the provided `agentId`.

### `rax diagnose`

Forensic CLI for recorded JSONL traces. Subcommands:

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

**`cause`** classifies a finished run from trace events only (never model text) with ordered, first-match-wins rules. It prints the cause, a confidence, the supporting events (`eventKind#seq`) and `missing`: the trace signals whose absence kept the verdict from being decisive. Confidence is `decisive` (read from authoritative signals), `probable` (fallback fields or heuristics; `missing` says what would upgrade it) or `insufficient-trace` (cause `undetermined`; the trace is too thin and the classifier does not guess). Causes: `direct-chat` (a trace holding only `llm-exchange` events, the direct chat path: not a run, skipped by the cohort tally), `timeout` / `user-stop` / `aborted` (from `run-aborted.reason`; `incomplete-trace` stays for a trace with neither `run-completed` nor `run-aborted`, or an abort with no reason), `provider-error` (sub-class from `outcome.errorClass`, text regex as legacy fallback), `satisfiability-abstain`, `terminal-mislabel` (includes `run-completed.status` contradicting `outcome.success`/`outcome.status`), `plan-posture-veto`, `never-engaged`, `tool-protocol`, `tool-failure`, `wrong-tool-arg`, `stall-after-work`, `stall-no-progress`, `loop-after-work`, `bookkeeping-loop`, `verifier-reject`, `budget-cap`, `unexplained` (a residual, never a finding), `success-with-warning` (a success whose verifier check failed or whose deliverable was accepted via `advisory-softfail`; states the fact, does not claim the answer is wrong), and `none` (healthy run). `--all` recurses a directory (default: the trace directories above), skips `llm-direct.jsonl`, and tallies cause by outcome status; `--real` drops synthetic (`test` provider) traces. The same result is on `RunAnalysis.cause` from `@reactive-agents/trace` (`analyzeCause(trace)`). `cause --json` also carries an `attribution` field (see `attribute` below).

**`attribute`** answers the next question about a failed run: is it your harness configuration or the model? It reads the recorded trace only (zero tokens) and works on any trace written by the trace recorder (`.withTracing()` or `.withObservability({ tracing: { dir } })`), with or without a grader verdict. A run counts as failed when `run-completed.status` is not `success`, `outcome.success` is false, or an `eval-graded` event failed; an abstention the grader accepts is `not-failed`. It finds the **divergence turn** (the `llm-exchange` whose output produced the failing file or final answer: from grader check names, else the contract or `outcome.outstanding` deliverables, else the run's writes), checks whether each tool result the run had obtained was in that turn's projected request, and checks what the harness did around it. Output: `verdict` (`harness` / `model` / `environment` / `unattributed` / `not-failed`), `reason`, `confidence` (`decisive` / `probable` / `insufficient-trace`), `divergenceTurn {iter, seq}`, `evidence` (`eventKind#seq` + detail), `missing` (the signals that would make it decisive) and `alsoMatched` (other reasons that also fired). Reasons, first match wins:

| Reason | What the trace shows |
|---|---|
| `model:fabrication-vetoed` | The run's terminal verifier refused the model's own answer for invented numbers or entities (`output-not-fabricated-*`). A grader that passed only part of the task does not make that veto false. |
| `harness:false-veto` | The grader passed but the run was marked failed; or (no grader) an outstanding deliverable is a template placeholder such as `out-N.txt` that matching writes already satisfy (`probable`). |
| `harness:tool-surface` | A contract-required tool had a `hidden:` reason on `tool-surface-resolved`. |
| `harness:tool-not-offered` | The model asked for a tool (a native call, or a JSON call printed in its text) that the request it answered did not offer, the tool never ran, and the run failed. Fires only when that turn offered no domain tool, or the trace shows the tool exists for the run (offered on another turn, on `tool-surface-resolved`, or required by the contract); a bare empty wire is `probable`. |
| `harness:contradictory-guidance` | The run's last LLM turn was a `think` turn whose request told the model to call a run tool but offered no schema for it; the model named that tool and it never ran. |
| `harness:subpass-abstained` | A kernel pass abstained before its first LLM call (`terminal_decision` with 0 LLM calls) and the run kept going on top of it, for example a plan step held to a required tool it could not see. |
| `harness:tool-call-dropped` | The model emitted a native tool call (for the graded file, or a resource the run never reached) and no `tool-call-start/end` followed before the next turn. |
| `harness:refusal-counted-as-repeat` | The repetition guard replaced a first call on a target (its count included calls that never ran): the write of a failing file whose content the failed check named, or the read of a task-listed input that then was never read. Any other replaced write of a failing file matches last, as `probable`: the trace cannot show its content would have passed. |
| `harness:refused-repairable` | A write boundary refused the content the model wrote for a failing file (`Refusing to write findings.json: the content is not valid JSON ...`), no later write of that path succeeded, and a content-preserving repair parses the refused content: stray quotes inside strings escaped (only backslashes inserted) or surplus closing brackets dropped. The harness could have saved the file. |
| `harness:misleading-refusal` | The same refusal, no repair parses the content, and the refusal carried a hint that contradicts its own fix (`Malformed JSON in arguments` on a content refusal whose arguments parsed; recorded before `dc7d9eb80`). |
| `model:invalid-content` | The same refusal, correct and actionable, and no repair parses the content. `probable` when the trace did not keep the refused content. |
| `harness:tool-call-corrupted` | A call the harness parsed from printed text reached the tool with object-literal source in a path-like argument (`{ path: "..." }` inside the path), failed, and that tool never succeeded before the divergence turn. |
| `harness:plan-fanout-blob` | A failing file holds content (40+ chars) that no native model call wrote to it, and the same content was written verbatim to another file: one step result fanned out into several files (plan-execute `{{from_step:...}}`). |
| `harness:premature-stop` | A harness stop (`dispatcher-early-stop`, `harness_synthesis`, a cap, ...) shipped an answer from a turn that predates the run's evidence; or cut a run whose file deliverable was unwritten while evidence was still growing with no repeated calls (`probable` when fewer than 2 iterations of budget were left). |
| `harness:completeness-blind` | The run ended on its own (no harness stop, no abstention, nothing outstanding) while files the grader required were never written, and the harness never knew they were required: neither the compiled contract nor any requirement the run ledger declared later covers them. The fix is a completeness signal (the contract), not the model's prompt. |
| `harness:offer-accepted-as-done` | The run ended on the model's own turn (no harness stop, no abstention) and the end of the shipped output offers to continue the work (`Would you like me to proceed with ...?`) instead of claiming done. `probable` without an `exit_gate` accept record. |
| `harness:evidence-withheld` | The model asked to read a task-listed input, the tool gate refused the read (or a guard notice replaced it), and the input was never read before the divergence turn. Needs a failed `eval-graded` event; `probable` when no failed check or target ties to the input. |
| `harness:evidence-truncated` | The divergence turn's request carried only a compressed preview of a tool result (`...N more lines`), or a projection/curator drop removed it. Always `probable`: the trace cannot prove the failed check needed the cut part. |
| `harness:evidence-missing` | A tool result the run obtained is absent from the divergence turn's request and no drop is recorded. `probable` when the recorder clipped the request (messages are capped at 2,000 chars). |
| `harness:misleading-guidance` | A typed guidance signal steered to a tool that was already satisfied, the model followed it, and the deliverable stayed unwritten. A retry steer naming a tool whose own last call failed does not count. |
| `harness:forcing-unused` | `model:ignored-guidance` or `model:evidence-not-gathered` matched, but the stalled turns offered domain tool schemas (native FC) and made no call, the harness forced none of them (act-or-answer off, or it did not fire there), and those unforced stalls are at least half of the completed tool-offered turns up to the divergence turn. Forcing that fired and still failed keeps the model label. Decisive when `run-started.config` records `actOrAnswer`; the model reason lands in `alsoMatched`. |
| `model:ignored-guidance` | A typed guidance signal told the model to call an unsatisfied required tool and the next turn did not (`probable` when it printed the call as text instead). |
| `model:evidence-not-gathered` | The divergence turn produced the failing output while a task-listed input had not been read, and nothing stopped the read. Needs a failed `eval-graded` event; `probable` when no failed check or target ties to the unread input. |
| `model:had-evidence-wrong-output` | Every tool result the run obtained was in the divergence turn's request and the grader still failed the output. Needs an `eval-graded` event. |
| (failure cause) | No rule above fired: the reason comes from the run's failure cause (the same classifier as `cause`), mapped to one owner and reported `probable`, with the cause in `from-cause`. `harness:{terminal-mislabel, plan-posture-veto, stall-after-work, loop-after-work}`, `model:{never-engaged, tool-protocol, wrong-tool-arg, stall-no-progress, bookkeeping-loop}`, `environment:{run-aborted, provider-error, budget-cap, tool-failure}`. Causes the trace cannot settle (a verifier reject, a satisfiability abstain, a wrong answer with no evidence check, an incomplete trace) stay `unattributed`. The map is `CAUSE_ATTRIBUTION` in `@reactive-agents/trace`. |
| `unattributed` | No rule could prove a side and the failure cause has no owner; `missing` names the signal that would. |

`environment` failures are outside both the harness and the model: a provider fault, an abort or timeout, your declared budget, or a tool that itself failed. A tool that refuses the content the model gave it is not an environment fault (see the three refusal reasons above). Without a grader, `model:had-evidence-wrong-output` cannot fire (the trace alone cannot say an answer is wrong); such runs report `unattributed` or `not-failed`. Append a deterministic grade to your trace as an `eval-graded` event to get it. `--all` recurses a directory and prints counts by verdict and reason.

Both modes also list the **mechanisms that acted** in each run, so you can check that a harness change you are testing actually ran: guards that did not pass (`guard:<guard>:<outcome>`), injected harness signals (`signal:<kind>@<origin>`), strategy switches (`strategy-switch:<from>-><to>`) and contract requirements by source (`requirement:<kind>@<source>`, with `declared-mid-run` for requirements added after compile). Single-run mode prints them on an `activity` line (`activity` array in `--json`); `--all` prints how many runs each key appeared in. Programmatic API: `attributeFailure(trace)`, `mechanismActivity(trace)` and `compareActivity(before, after)` from `@reactive-agents/trace`.

Run IDs accept a bare ULID (resolves under `~/.reactive-agents/traces/`), an absolute path to a `.jsonl` file, or the literal `latest`. Override the trace directory with `REACTIVE_AGENTS_TRACE_DIR`.

Export a run's raw trace by id: `rax diagnose replay <runId> --raw > run.jsonl` (prints the recorded JSONL verbatim).

**Trace retention.** Traces are classified by provenance from the run's first event: a `test` provider/model is *synthetic*, everything else (including unknown) is *real*. Synthetic traces are pruned aggressively (older than `RA_TRACE_SYNTHETIC_MAX_AGE_HOURS`, default 24, or beyond `RA_TRACE_SYNTHETIC_MAX_FILES`, default 200). Real traces are deleted only when both older than `RA_TRACE_REAL_MAX_AGE_DAYS` (default 90) and outside the newest `RA_TRACE_REAL_MIN_RUNS` (default 500), or beyond a `RA_TRACE_REAL_MAX_BYTES` size cap (default 4 GiB, oldest first, never inside the protected newest runs). Files modified in the last 10 minutes are never deleted. Under `bun test`, default tracing is redirected to a per-process temp dir so tests never write to your real corpus.

Snapshot/Replay re-execution is API-only — see [Snapshot & Replay](/features/snapshot-replay/) for the `replay(recordedRun, builderFn)` workflow.

The standalone bin `rax-diagnose <sub>` is kept for backwards compatibility; new code should prefer the unified `rax diagnose <sub>` form.

### `rax version`

```bash
rax version
rax --version
rax -v
```

### `rax help`

```bash
rax help
rax --help
rax -h
```
