---
type: debrief
status: completed
tags: [harness, dx, ollama, adversarial-review, performance]
created: 2026-08-10
authored-by: opencode
related: [[2026-08-07-qa-sweep-findings]]
---

# New User Adversarial Review - 2026-08-10

## Scope

Built and ran independent agents from `scratch.ts` against local Ollama models,
without Anthropic:

- `qwen3:4b`: synthesis, custom tool calling, required-tool abstention,
  malformed-tool prompt, stream cancellation and reuse.
- `qwen3:14b`: the same two-call calculator task.
- A nonexistent model name: build/run failure behavior.

The probe recorded build time, run time, tokens, steps, tool calls, termination,
abstention, and receipts. The framework was run from the repository at the
2026-08-10 working tree.

## Findings

### F1 - `terminate()` does not stop the underlying execution [P1]

The stream probe received `StreamCancelled` and reported `firstStatus=terminated`,
but framework logs showed a second execution start while the first model request
was still completing. Source confirms the stream execution is daemon-forked at
`packages/runtime/src/engine/execute-stream.ts:811-814`; `terminate()` aborts the
consumer controller at `packages/runtime/src/run-controller.ts:247-251`, while
the loop checkpoint only checks the soft stop flag at lines 263-270.

Impact: cancelled local inference can continue consuming GPU/CPU, a subsequent
run can overlap it, and users cannot safely enforce cancellation or concurrency
budgets. Make termination propagate to the execution fiber/provider request, or
make the API explicitly distinguish stream detachment from execution cancellation.
Add an in-flight provider cancellation witness before documenting this as fixed.

### F2 - Missing model names pass `build()` and fail opaquely at `run()` [P1]

`RA_MODEL=definitely-not-pulled` built in 45 ms, then failed at run time with
`terminatedBy: "llm_error"`, zero tokens, and an empty `output`. The useful
diagnostic was only printed to the console. The builder already has
`withStrictValidation()`, but a new user has no reason to know that model
existence is lazy by default.

Impact: configuration errors appear far from configuration time and the returned
result does not carry a typed provider/model error. Probe `/api/tags` for Ollama
models during build when requested, or at minimum return the provider error and
an actionable suggestion in `AgentResult`.

### F3 - Build-time output discloses an API-key prefix [P1 security/DX]

Every build printed `Provider: ... | API key: <first eight characters>...***`,
even with reactive-intelligence telemetry disabled and no observability layer.
This comes from `packages/runtime/src/build-validation.ts:338-347`.

Impact: CI logs, screenshots, copied bug reports, and hosted process logs receive
a stable secret prefix. Do not print key material at all; report only
`configured` / `missing` (and make this build banner opt-in or structured).

### F4 - Default execution logging is noisy and not controlled by telemetry [P2]

`telemetry: false` suppressed the telemetry notice but not provider/build banners,
phase progress, completion lines, or metrics. Source separates the anonymous
telemetry option from the always-created `ObservableLogger` in
`packages/runtime/src/execution-engine.ts:1671-1702`.

`.withObservability({ verbosity: "minimal", live: false })` made the run output
mostly machine-readable, but the provider banner still printed. A new CLI/API
consumer needs a documented single quiet switch, especially for libraries and
JSON-producing processes.

### F5 - User-visible output can omit requested tool findings [P2]

On `qwen3:4b`, the task explicitly asked to report both calculator results, but
`result.output` was only `16648`. The receipt correctly said `tool-grounded` and
the tool calls succeeded, so the evidence existed, but the final answer did not
honor the reporting requirement. `qwen3:14b` did include both results, showing
model variance rather than a universal failure.

The runtime's final output is primarily the last model response and only falls
back to the last eligible observation. For structured or deliverable-oriented
tasks, expose a requirement/deliverable completeness check or make the receipt
surface the missing requested facts instead of treating this as a successful
grounded result.

### F6 - Simple local tool work has a large multi-generation cost [P2 performance]

The two-call calculator task produced 9 framework steps and 4,507 tokens on
`qwen3:4b` in 10.8 seconds. On `qwen3:14b`, it produced the same 9 steps and
7,266 tokens in 90.0 seconds. The task required two deterministic tool calls,
but the harness performed three model generations around them. This is partly
model speed and partly expected agent-loop behavior, not a measured regression.

Recommended follow-up: add a low-latency/local profile that minimizes redundant
thought turns after successful required tools, and publish a per-iteration token
breakdown so users can distinguish provider generation cost from harness cost.

## Positive findings

- Custom tools worked with the public builder and typed receipt data.
- Required unavailable tools abstained before an LLM call: zero tokens and an
  actionable `abstention.missing` entry.
- Malformed-tool prompting still produced a successful calculator call on the
  4B model.
- A cancelled stream emitted a cancellation event and the same agent was reusable
  for a second run from the public API.

## Recommended Priority

1. Propagate hard cancellation to the daemonized execution/provider request.
2. Remove API-key prefixes from all logs and make build output opt-in.
3. Return typed, actionable provider/model errors in `AgentResult` and offer
   eager Ollama model validation.
4. Add a quiet/library mode that suppresses every console side effect.
5. Add deliverable-level checks for explicit multi-fact reporting requirements.
6. Instrument and optimize local-tier iteration/token overhead.

## Live Follow-up Matrix

Additional live runs used the repository's controlled example suite and the
expanded `scratch.ts` probe:

| Run | Model | Result |
|---|---|---|
| `perf-bottleneck-isolation.ts` V1 | `qwen3:4b` | Warm no-tool task: 270 tokens, 1.2s; non-LLM framework work was ~1-2% of runtime. |
| `perf-bottleneck-isolation.ts` V3 | `qwen3:4b` | Built-in file task: 6,691 tokens, 12.2s, 10 iterations, `max_iterations`, no file tools reached. |
| `perf-bottleneck-isolation.ts` V3 | `qwen3.5:latest` | Same task: 8,397 tokens, 10 iterations, 19.8s, `max_iterations`; repeated `discover-tools`, no file tools reached. |
| `local-vs-frontier.ts` | `qwen3:4b` | Two custom tools completed, 3 LLM calls, 3,947 tokens, 61.9s, 8 steps. |
| `run-pass-probe.ts` | `qwen3.5:latest` | Reactive completed in 4.0s / 2,538 tokens; reflexion completed in 17.7s / 4,006 tokens. |
| `finalize-probe-tools.ts` | `qwen3:4b` | Reflexion completed in 136.3s / 4,506 tokens for one crypto lookup; the following plan-execute arm exceeded the probe timeout. |
| `scratch.ts` explicit builtins | `qwen3.5:latest` | `file-write` and `file-read` both succeeded, but terminal verification failed on the remapped path. |

## Follow-up Findings

### F7 - `.withTools()` is an example-suite and DX trap [P1/P2]

The controlled performance example uses `.withTools()` at
`apps/examples/src/research/perf-bottleneck-isolation.ts:67` while asking the
model to write and read a file. The live trace showed only `discover-tools` and
`final-answer` in the tool schema; discovery returned `No tools registered` on
every attempt. Both `qwen3:4b` and `qwen3.5:latest` exhausted the iteration cap
without calling `file-write` or `file-read`.

The public API intentionally requires built-in opt-in, so this is partly an
example defect. It is still a serious new-user failure because `.withTools()`
reads like “enable the framework tools,” and the example itself demonstrates the
wrong configuration for its task.

Recommended change: make examples explicit (`builtins: ["file-write",
"file-read"]`) and make `build()` warn or fail when the task contract names
built-ins that are neither registered nor opted in. A missing capability should
produce a typed configuration/abstention result, not enter model discovery.

### F8 - Tool discovery can become an unproductive LLM loop [P1]

Trace `01KZNZCS7C3MNN8HZ34E2PWHJX` contains 7 LLM exchanges and 7 discover-tools
actions. The model received `No tools registered` repeatedly, then invoked
`final-answer` with a fabricated claim that the file had been written. The run
ended at `max_iterations` with zero verifier verdicts and zero harness signals.

The trace's assessment stayed `phase=orient`, `req=0/3`, `deliv=0/1`, and
`evidenceDelta=0` for the entire run. The harness had enough deterministic
evidence to stop after the first unavailable-tool result, but no no-progress
control signal fired.

Recommended change: treat “no tools registered” and repeated identical discovery
queries as deterministic control facts. The supervisor should either fail fast
with the missing capability and builder remedy, or abstain immediately. Discovery
must never be allowed to consume the full agent iteration budget without new
evidence.

### F9 - Healing changes the path but terminal verification uses the original path [P1]

The explicit built-in control arm requested `/tmp/reactive-agents-scratch.txt`.
The live LLM trace shows successful `file-write`, successful `file-read`, and the
read result `ok`. The tool observation reported `Written to
./reactive-agents-scratch.txt`; the file was intentionally confined/remapped and
was not created at `/tmp`.

The final receipt nevertheless declared the deliverable spec as
`.//tmp/reactive-agents-scratch.txt`, `produced:false`, and the run failed after
`max_iterations` despite successful tool operations. The relevant implementation
split is:

- `packages/tools/src/healing/path-resolver.ts:43-55` remaps absolute paths
  outside the working directory to the working-directory basename.
- `packages/tools/src/skills/file-operations.ts:371-386` executes the healed
  path under the file root.
- Receipt/delivery verification consumes the original contract/path rather than
  the canonical healed path.

This is a boundary disagreement between the raw model arguments retained in the
action/artifact projection, the healed arguments used for execution, and
`verifyDelivery()`'s filesystem check. Recommended change: make path
normalization return a typed canonical argument/artifact identity that is
recorded in the ledger and consumed by delivery verification. Alternatively
reject the original absolute path before execution and give the model the allowed
root. Never execute one canonical path while recording or verifying another.

### F10 - Successful failed-tool recovery is ambiguously trusted [P2]

The `tool-failure-recovery` scratch run called a tool that returned an upstream
failure, then honestly reported that the lookup was unavailable. The run returned
success with `verifierVerdict: "pass"`, receipt verdict `partially-grounded`,
`toolsUsed: []`, and one failed tool call in `toolCallStats`.

This may be an intentional “honest answer despite unavailable evidence” policy,
but the public result does not make that distinction clear. A consumer sees a
successful result while the receipt says there was no successful grounding.

Recommended change: expose an explicit terminal status or trust state such as
`completed-with-failed-evidence` / `unverified`, keep failed invocations in the
receipt's tool list, and make `success` mean contract completion rather than merely
absence of fabrication.

### F11 - Example code still reads obsolete result fields [P2 DX]

`apps/examples/src/reasoning/run-pass-probe.ts:57-68` reads `result.status` and
`result.steps`. The live example reported `status=unknown` and `steps=0` even
though the run had completed and the framework metadata contained the actual
values. The probe still passed because it checked output text rather than the
reported status or steps.

Recommended change: run the example suite against a typed public-result contract
in CI, remove obsolete field reads, and make example pass criteria assert the
fields users are expected to consume. A passing example that reports fabricated
telemetry is worse than a failing example.

### F12 - Heavy strategies are not cost-safe for local simple tasks [P1/P2]

The same one-tool crypto task showed a large strategy cost spread. On
`qwen3.5:latest`, reactive used 2,538 tokens and 4.0s while reflexion used 4,006
tokens and 17.7s. On the slower `qwen3:4b`, reflexion used 4,506 tokens and
136.3s; the following plan-execute arm exceeded the 240-second probe window.

This is expected strategy behavior, but the public/default routing does not make
the cost boundary obvious. A simple tool lookup should not silently enter a
critique/improvement strategy with a 30x latency tail.

Recommended change: compile a task/model execution profile before strategy
selection. Default local simple tasks to reactive/direct, impose explicit
per-strategy token/time budgets, and require an evidence-backed reason before
promoting to reflexion, plan-execute, or tree-of-thought. Surface the selected
strategy and projected budget in the run receipt.

### F13 - Max-iteration failure can lack a useful terminal diagnosis [P2]

The built-in file loop and the performance V3 traces ended at `max_iterations`
after zero evidence progress or after a partial tool sequence. The trace often
contained no verifier verdict and no harness signal, leaving the user with a
generic failure despite the assessment already knowing the outstanding
requirements and deliverables.

Recommended change: make every budget/iteration terminal carry the final
`RunAssessment`, missing criteria, last control decision, repeated-call summary,
and remediation hint in `AgentResult`, `receipt`, and the terminal stream event.
Budget exhaustion should be an explainable outcome, not an empty output plus a
counter.

## Follow-up Priority

1. Canonicalize healed tool arguments and feed the canonical artifact identity
   into the ledger and terminal verifier.
2. Add deterministic no-capability/no-progress termination for discovery loops.
3. Fix `.withTools()` examples and add build-time capability diagnostics.
4. Make strategy selection cost-aware for local simple tasks.
5. Unify failed-evidence semantics in `success`, receipt verdicts, and tool-call
   reporting.
6. Make max-iteration results include assessment, missing work, and remediation.
7. Repair stale example result-field usage and enforce example telemetry checks.
