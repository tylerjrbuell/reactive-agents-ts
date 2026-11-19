# @reactive-agents/diagnose

> `rax-diagnose`: explain why a recorded Reactive Agents run failed, whether the harness or the model is at fault, and what to fix. Zero tokens.

[![npm](https://img.shields.io/npm/v/@reactive-agents/diagnose?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/diagnose)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/concepts/decision-tracing/)

> **Stability:** unstable. Not in the stable tier; command output and attribution reasons can change between minors. Pin an exact version.

## Install

```bash
bun add @reactive-agents/diagnose
# or: npm install -g @reactive-agents/diagnose   # exposes the `rax-diagnose` bin
```

## Try it on a real failed run

The package ships one recorded failed run (qwen2.5-coder:14b via Ollama), so you can try it with no API key, no model and no run of your own:

```bash
npm install @reactive-agents/diagnose
npx rax-diagnose cause node_modules/@reactive-agents/diagnose/examples/failed-run.jsonl
npx rax-diagnose attribute node_modules/@reactive-agents/diagnose/examples/failed-run.jsonl
```

`cause` reports `cause=never-engaged confidence=decisive`: the model never called the tool it needed. `attribute` reports `harness (harness:contradictory-guidance)`: the request told the model to call `file-write` but offered no tool schemas, so the harness, not the model, is at fault.

## Usage

Point `rax-diagnose` at a trace recorded by `@reactive-agents/trace`. A run ID is a bare ID resolved under `~/.reactive-agents/traces/`, an absolute path to a `.jsonl` file, or `latest`.

```bash
rax-diagnose list --limit=3          # recent traces
rax-diagnose cause latest            # how the run ended, with evidence
rax-diagnose attribute latest        # harness or model? plus the mechanisms that acted
rax-diagnose attribute --all <dir>   # tally reasons across a directory of traces
```

Output for a successful run:

```text
01M7NE5GJH9VSRNKGF204718HR: cause=none confidence=decisive status=success authority=model-final
  evidence  run-completed#88  status=success terminatedBy=end_turn; deliverable_decision=pass (verified)
  meaning   Finished normally
```

For a failed run, `attribute` reports a verdict (`harness`, `model`, `environment` or `unattributed`), a reason such as `harness:tool-not-offered` or `model:never-engaged`, the divergence turn and the evidence. `attribute --all <dir>` prints failed runs by verdict and a ranked reason table.

More commands:

```bash
rax-diagnose replay latest                 # pretty-print the timeline
rax-diagnose replay <runId> --only=verifier-verdict,harness-signal-injected
rax-diagnose grep latest "e.kind === 'run-completed'"   # JS predicate over events, JSONL out
rax-diagnose diff <runIdA> <runIdB>        # structural diff between two runs
rax-diagnose debrief <runId>               # decision timeline with rationale
```

The same commands ship inside the main CLI as `rax diagnose <subcommand>`.

## API

CLI commands:

| Command | Use it when |
|---|---|
| `list` | You need a recent run ID (`--limit=N`). |
| `replay <runId>` | You want the event timeline (`--raw`, `--json`, `--only=k1,k2`). |
| `replay-run <runId>` | You want recorded-run metadata to re-execute with `replay()` from `@reactive-agents/replay` (`--json`). |
| `grep <runId> "<expr>"` | You filter events with a JS predicate; `e` is the event. |
| `diff <runIdA> <runIdB>` | You compare two runs. |
| `debrief <runId>` | You want the decision timeline with rationale (`--json`). |
| `signals <runId>` | You find harness signals that never landed: not rendered, not classified, or ignored by the model (`--json`). |
| `cause <runId>` | You want the deterministic cause of how a run ended; `--all [dir]` tallies a directory, `--real` skips synthetic traces, `--json`. |
| `attribute <runId>` | You want harness-vs-model attribution; `--all [dir]`, `--real`, `--json`. |

Environment: `REACTIVE_AGENTS_TRACE_DIR` overrides the trace directory; `REACTIVE_AGENTS_TRACE=off` disables recording.

Programmatic API: each command is exported for tests and tooling (`listCommand`, `replayCommand`, `replayRunCommand`, `grepCommand`, `diffCommand`, `debriefCommand`, `signalsCommand`, `causeCommand`, `attributeCommand`), along with `classifyDirectories`, `attributeDirectories`, `tallyActivity`, `resolveTracePath`, `listTraces` and `DEFAULT_TRACE_DIR`.

```ts
import { attributeDirectories } from "@reactive-agents/diagnose";

const runs = await attributeDirectories(["./traces"], { real: true });
for (const r of runs) console.log(r.attribution.verdict, r.attribution.reason);
```

## Documentation

- [Decision tracing](https://docs.reactiveagents.dev/concepts/decision-tracing/)
- [CLI reference](https://docs.reactiveagents.dev/reference/cli/#rax-diagnose)
- [`@reactive-agents/trace` on npm](https://www.npmjs.com/package/@reactive-agents/trace) records the traces and holds the analyzers.

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
