# @reactive-agents/diagnose

> Forensic CLI for recorded Reactive Agents traces — replay, grep, diff, and debrief agent runs

[![npm](https://img.shields.io/npm/v/@reactive-agents/diagnose?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/diagnose)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

A **forensic CLI for debugging AI agent runs**. Point `rax-diagnose` at a recorded trace and pretty-print the timeline, filter events with a JS predicate, structurally diff two runs, or print a decision timeline with rationale ("why this path"). It replaces ad-hoc log-spelunking with deterministic, structured **LLM agent observability** over traces recorded by `@reactive-agents/trace`.

## Install
```bash
bun add @reactive-agents/diagnose
# or: npm install -g @reactive-agents/diagnose   # exposes the `rax-diagnose` bin
```

## Usage
```bash
rax-diagnose list                    # show recent traces
rax-diagnose replay latest           # pretty-print the timeline of the newest run
rax-diagnose replay <runId> --raw    # one event per line, no grouping
rax-diagnose replay <runId> --json   # raw JSONL stream
rax-diagnose replay <runId> --only=verifier-verdict,harness-signal-injected
rax-diagnose replay-run <runId>      # recorded run metadata for re-execution via replay()
rax-diagnose grep latest "e.kind === 'verifier-verdict' && !e.verified"
rax-diagnose diff <runIdA> <runIdB>  # structural diff between two runs
rax-diagnose debrief <runId>         # decision timeline with rationale
```

Run IDs accept a bare ULID (resolved under `~/.reactive-agents/traces/`), an absolute path to a `.jsonl` file, or the literal `latest` alias.

## CLI commands
- `list` — show recent traces (`--limit=N`).
- `replay <runId>` — pretty-print the event timeline; `--raw`, `--json`, `--only=k1,k2`.
- `replay-run <runId>` — show recorded run metadata for re-execution via the `replay()` API; `--json`.
- `grep <runId> "<expr>"` — filter events with a JS predicate (`e` is the event); outputs JSONL.
- `diff <runIdA> <runIdB>` — structural diff between two runs.
- `debrief <runId>` — decision timeline with rationale; `--json`.

## Environment
- `REACTIVE_AGENTS_TRACE_DIR` — override the default trace directory.
- `REACTIVE_AGENTS_TRACE=off` — disable trace recording in agent runs.

## Programmatic API
The CLI is the primary surface, but each command is also exported for tests and tooling:
`listCommand`, `replayCommand`, `replayRunCommand`, `grepCommand`, `diffCommand`, `debriefCommand`, plus `resolveTracePath`, `listTraces`, and `DEFAULT_TRACE_DIR`.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [Observability docs](https://docs.reactiveagents.dev) and the [full documentation](https://docs.reactiveagents.dev).
