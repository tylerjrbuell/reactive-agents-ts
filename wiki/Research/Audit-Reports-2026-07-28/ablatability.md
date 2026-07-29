# Ablatability audit (Task 15, A-tier gap-closure gate 3)

**Date:** 2026-07-28 (session continued 2026-07-29).
**Rule:** every default-on mechanism must be independently ablatable, because
`RA_LAZY_TOOLS` gating three mechanisms in two directions at three call sites
is exactly what made F3 unmeasurable for months (see
[[../../Failure-Modes/RUNNING-CATALOGUE#F3]]).
**Gate:** `scripts/check-ablatable.sh`, registered as Check 9 in
`scripts/check-cross-cutting.sh`.
**Lift-evidence source:** [[../Harness-Reports/2026-07-28-rung1-flag-inertness.md]]
(rung 1 of the measurement ladder — deterministic replay, zero tokens, control
flow only, not accuracy and not cost).

## Method

`grep -rn "process.env.RA_" packages --include=*.ts | grep -v dist | grep -v test`
enumerated every direct read. For each hit: does it resolve through
`packages/reasoning/src/harness-flags.ts`, or is it read at the use site? Nine
mechanism reads were strays (routed below); the remainder are deployment
config, debug-only diagnostics, or trace-retention housekeeping — none of
which gate a "mechanism" in the F3 sense (no accuracy/token lift to measure,
nothing to ablate independently), and are excluded from the gate with the
reasoning recorded per-item below.

## Every default-on mechanism, its killswitch, and its verdict

| Mechanism | Flag | Default | Resolver | Lift evidence | Verdict |
|---|---|---|---|---|---|
| Per-iteration lazy tool disclosure | `RA_LAZY_TOOLS` | ON | `lazyDisclosureEnabled()` | **INERT** (rung1, 4/4 goldens) | **Demote to opt-in candidate — see below** |
| `discover-tools` meta-tool registration | `RA_TOOL_DISCOVERY` | ON | `toolDiscoveryEnabled()` | **INERT** (rung1, 4/4 goldens) | **Demote to opt-in candidate — see below** |
| Verbose ReAct RULES block | `RA_VERBOSE_RULES` | OFF | `verboseRulesEnabled()` | INERT-by-construction (rung1; prompt-only, replay cannot see it) | Keep opt-in; not a deletion candidate on this signal |
| Stable tool surface (F10) | `RA_STABLE_TOOL_SURFACE` | OFF | `stableToolSurfaceEnabled()` | Untestable-by-construction (rung1; corpus only widens, nothing needs the narrower surface) | Keep opt-in; awaiting rung2/rung3 lift verdict (Task 13) |
| Recency budget override | `RA_RECENCY_BUDGET_CHARS` | derived | `recencyBudgetCharsOverride()` *(new)* | INERT (rung1, swept as part of the flag sweep) | Keep — test/ablation knob, not a behavior mechanism per se |
| Tool-result preserve budget override | `RA_TOOL_RESULT_BUDGET_CHARS` | tier default | `toolResultBudgetCharsOverride()` *(new)* | INERT (rung1) | Keep — same as above |
| Thought continuity | `RA_THOUGHT_CONTINUITY` | OFF | `thoughtContinuityEnabled()` *(new)* | INERT (rung1, 4/4 goldens) | Keep opt-in; no evidence either way to delete |
| Single/batch tool-observe symmetry | `RA_TOOL_OBSERVE_SYMMETRY` | OFF | `toolObserveSymmetryEnabled()` *(new)* | INERT (rung1, 4/4 goldens) | Keep opt-in; hot-path change, needs a live arm before any default flip |
| Rationale-audit gate | `RA_RATIONALE_AUDIT` | OFF | `rationaleAuditEnabled()` *(new)* | INERT (rung1, 4/4 goldens) | Keep opt-in |
| Tree-of-thought explore budget | `RA_TOT_EXPLORE_BUDGET_MS` | 120s | `treeOfThoughtExploreBudgetMs()` *(new)* | UNTESTABLE (rung1; no golden runs ToT) | Keep — no evidence to act on |
| Overhaul `write_result_to_file` meta-tool | `RA_OVERHAUL` | OFF | `overhaulEnabled()` *(new, in `packages/runtime`)* | INERT (rung1, 4/4 goldens) | Keep opt-in |
| Assembly debug trace | `RA_ASSEMBLY_DEBUG` | OFF | `assemblyDebugEnabled()` *(new)* | not swept (diagnostic-only, no behavior to measure) | Keep — diagnostic, not a mechanism |
| Prompt dump to disk | `RA_PROMPT_DUMP` | OFF | `promptDumpPathPrefix()` *(new)* | not swept (diagnostic-only) | Keep — diagnostic, not a mechanism |
| Strict A2A egress (refuse private peers) | `RA_AGENT_STRICT_EGRESS` | OFF | `agentStrictEgressEnabled()` *(new, `packages/a2a/src/flags.ts`)* | not swept (security posture, not a reasoning mechanism; no golden exercises A2A egress) | Keep — security default, no lift to measure |
| Docker sandbox for code/shell execution | `RA_SANDBOX` | OFF (host) | `sandboxDockerEnabled()` *(new, `packages/tools/src/flags.ts`)* | UNTESTABLE (rung1; needs a live Docker daemon, no golden can exercise it) | Keep — correctness/isolation mechanism, not a token/accuracy lift candidate |
| HTTP egress guard bypass | `RA_HTTP_ALLOW_PRIVATE` | OFF (guard active) | `httpAllowPrivateEnabled()` *(new, `packages/tools/src/flags.ts`)* | not swept (security posture) | Keep — security default |

### `RA_LAZY_TOOLS` and `RA_TOOL_DISCOVERY` — INERT on this corpus, per the project's own pre-filter

09 §7's rule: a mechanism showing **zero divergence across the golden
corpus** is demoted or deleted **without spending a live arm on it**. Rung1
measured exactly that for both flags — no control-flow divergence on any of
the 4 attributable goldens (`abstain`, `answer-only`, `terse-tool-loop`,
`tool-write`; `planned-tool-loop` excluded from the sweep for the unrelated,
pre-existing reason D-2026-07-28-D, an argsHash reconciliation bug, not a
polarity or corpus problem specific to these flags).

Applying the rule plainly rather than just reporting the data: **on the
current corpus, `RA_LAZY_TOOLS` and `RA_TOOL_DISCOVERY` are demotion
candidates by the letter of 09 §7.** This audit does **not** execute that
demotion here, for one reason the rung1 report itself states explicitly and
that this audit will not paper over: the corpus's 4 attributable goldens all
carry small, fully-required `builtins` lists that are never pruned narrow
enough to need discovery in the first place — i.e. the INERT verdict may be a
**corpus-coverage gap** (the corpus cannot currently exercise the mechanism
the same way `RA_STABLE_TOOL_SURFACE` cannot), not proof the mechanism is
dead weight on real tasks. `RA_LAZY_TOOLS` is also the harness's flagship
token-savings mechanism (F10: 41% raw-token reduction, independent of the
cache-money question); demoting a mechanism this load-bearing on a 4-golden
corpus with a known coverage hole, without first growing the corpus or
running a live arm, would be exactly the kind of confident-but-wrong
conclusion `feedback_instrument_before_conclusion` warns against. **Verdict:
KEEP, flagged for corpus growth before any demotion decision** — grow the
golden corpus with a case where pruning actually excludes a required tool
(tracked against the same coverage-gap note in the rung1 report), then
re-run the sweep. Do not read "INERT" alone as "safe to delete" here; the
09 §7 pre-filter is about skipping a *live arm*, not about skipping the
"is the corpus even wide enough" check that has to happen first.

### `RA_VERBOSE_RULES` — INERT-by-construction, not by measurement

Rung1's own conclusion: this is a prompt-only addition, and replay answers
from a FIXED recorded table rather than asking a live model to react to a
changed prompt, so this flag is **structurally invisible** to a control-flow
diff regardless of how many times it's re-run or how the corpus grows.
**Distinct finding from a genuine INERT** — do not delete on this signal.
**Verdict: keep opt-in**, no action.

### `RA_STABLE_TOOL_SURFACE` — untestable by construction, not INERT

Per rung1: this flag only ever *widens* the visible tool surface (a strict
superset of the lazily-pruned set), and every golden in the corpus has a
`builtins` set small enough that lazy pruning never excludes anything either
— so there is no golden where a call succeeds under the wide surface but
would have been rejected under the narrow one. This is **not** "ran and did
nothing" (that is what INERT means for `RA_LAZY_TOOLS`/`RA_TOOL_DISCOVERY`
above); it is "the only channel through which this flag could show up in a
replay-based control-flow diff is not exercised by any committed golden." No
demotion signal either way. **Verdict: opt-in, pending the rung2/rung3 lift
verdict** (Task 13) — that is the live arm this flag was built for
(`disclosure-ablation.ts`'s `stable-surface` arm, Task 10).

### `REACTIVE_AGENTS_EVIDENCE_DELTA_RESET` — new line item, needs its own review

Not a `RA_*` flag (different prefix, out of this audit's mechanical grep
scope per Step 1), and already routed through exactly ONE resolver
(`evidenceResetActive()` in `packages/reasoning/src/kernel/assessment/guard-adapters.ts:36-41`)
— so it does not fail `check-ablatable.sh` and is not a "stray" in the sense
this gate checks for. It is flagged here because rung1 surfaced an
**incidental finding**: `REACTIVE_AGENTS_EVIDENCE_DELTA_RESET=1` came back
**LIVE** on `terse-tool-loop` — the only LIVE verdict in the entire sweep
besides the flags this task added — and the mechanism of divergence was an
**extra model call** (replay hit `"replay: no recorded exchange"`, i.e. the
harness asked for one more turn than the fixed table has). The flag's own
doc comment states it is deliberately *"NOT a public wither... exists to be
measured, not shipped"* and is gated behind `horizonActive` in production —
but a fixed-table replay run has `horizonActive` unset by default, and this
flag still changed iteration count on a golden that carries no long-horizon
profile. That is worth a dedicated look: either the `horizonActive ||`
short-circuit in `evidenceResetActive()` is not actually gating this golden
the way the doc comment claims, or `terse-tool-loop`'s recorded table is
brittle to iteration-count changes in a way that would also trip on a
legitimate horizon-profile run. **Verdict: no verdict yet — filed as a
follow-up, not resolved by this audit** (out of Task 15's `RA_*` scope; needs
its own investigation of `guard-adapters.ts` + the `terse-tool-loop` golden).

## Strays found and fixed (routed through a named resolver)

Nine direct-read sites, across three resolver homes:

**`packages/reasoning/src/harness-flags.ts`** (existing canonical resolver;
`packages/runtime` can import it because `runtime` depends on `reasoning`,
never the reverse):
1. `RA_RECENCY_BUDGET_CHARS` — was `assembly/capability.ts:63-65` → `recencyBudgetCharsOverride()`
2. `RA_TOOL_RESULT_BUDGET_CHARS` — was `assembly/capability.ts:74-76` → `toolResultBudgetCharsOverride()`
3. `RA_THOUGHT_CONTINUITY` — was `assembly/stages/project-results.ts:67` → `thoughtContinuityEnabled()`
4. `RA_TOOL_OBSERVE_SYMMETRY` — was `kernel/capabilities/act/act.ts:166` → `toolObserveSymmetryEnabled()`
5. `RA_RATIONALE_AUDIT` — was read at **two** sites, `kernel/capabilities/reason/think.ts:626` AND `strategies/plan-execute.ts:370` — exactly the multi-site-same-flag shape this audit exists to close, even though (unlike `RA_LAZY_TOOLS`) both sites already agreed on direction → `rationaleAuditEnabled()`
6. `RA_TOT_EXPLORE_BUDGET_MS` — was `strategies/tree-of-thought.ts:231` → `treeOfThoughtExploreBudgetMs()`
7. `RA_ASSEMBLY_DEBUG` — was `kernel/capabilities/reason/think.ts:520` → `assemblyDebugEnabled()`
8. `RA_PROMPT_DUMP` — was `kernel/capabilities/reason/think.ts:526-527` → `promptDumpPathPrefix()`
9. `RA_OVERHAUL` — was `packages/runtime/.../runtime-construction.ts:339` → `overhaulEnabled()`, re-exported from `packages/reasoning/src/index.ts`

**`packages/a2a/src/flags.ts`** (new local resolver — see "Why two flags
could not route to `harness-flags.ts`" below):
- `RA_AGENT_STRICT_EGRESS` — was read at **two** sites in **two packages**:
  `packages/a2a/src/client/discovery.ts:14` and
  `packages/runtime/src/builder/build-effect/remote-agent-tools.ts:28`. Both
  now call `agentStrictEgressEnabled()`; `runtime`'s call imports it from
  `@reactive-agents/a2a` (a dependency it already has), rather than
  duplicating the resolver.

**`packages/tools/src/flags.ts`** (new local resolver, same reason):
- `RA_SANDBOX` — was read at **two** sites within the same package:
  `skills/code-execution.ts:155` and `skills/shell-execution.ts:721` →
  `sandboxDockerEnabled()`.
- `RA_HTTP_ALLOW_PRIVATE` — was `skills/http-client.ts:65` → `httpAllowPrivateEnabled()`.

## Why two flags could not route to `packages/reasoning/src/harness-flags.ts`

Checked the dependency graph before deciding (`package.json` `dependencies`
per package):

- `packages/reasoning` depends on `tools`, `llm-provider`, `memory`,
  `observability`, `prompts`, `core` — **not** on `a2a`.
- `packages/a2a` depends on `core`, `runtime-shim`, `identity` — **not** on
  `reasoning`.
- `packages/tools` depends on `core`, `llm-provider`, `runtime-shim` — **not**
  on `reasoning`. (`reasoning` depends on `tools`, i.e. the edge runs the
  other way.)
- `packages/runtime` depends on **both** `reasoning` and `a2a` (and `tools`
  transitively via `reasoning`).

So `RA_AGENT_STRICT_EGRESS` (needed in `a2a` and `runtime`) and `RA_SANDBOX` /
`RA_HTTP_ALLOW_PRIVATE` (needed in `tools`) cannot be resolved through
`packages/reasoning/src/harness-flags.ts` without adding a package edge that
would either cycle (`a2a`/`tools` → `reasoning`) or misplace ownership
(a reasoning-owned file deciding an A2A egress policy or a shell-sandbox
policy). Each got its own local resolver file instead, following the exact
same pattern (one flag, one named, documented function, every call site
imports it) — the principle `check-ablatable.sh` enforces is "one resolver
per flag," not "every resolver must physically live in one specific file."

## Excluded from the gate — not mechanism killswitches

Recorded here, and each pattern is named individually in
`scripts/check-ablatable.sh` (no directory-wide exclusion), so a new stray in
these files still gets caught by name-based exclusion drift:

| Flag(s) | File | Why excluded |
|---|---|---|
| `RA_A2A_HOST`, `RA_A2A_TOKEN` | `packages/a2a/src/server/http-server.ts` | Server bind address / auth token for standing up the A2A HTTP server — deployment config, not a reasoning/behavior switch. No lift to measure. |
| `RA_HEALTH_HOST`, `RA_HEALTH_TOKEN` | `packages/health/src/service.ts` | Same — health-check server bind config. |
| `RA_JUDGE_HOST`, `RA_JUDGE_TOKEN` | `packages/judge-server/src/index.ts` | Same — judge server bind config. |
| `RA_GEMINI_DEBUG` | `packages/llm-provider/src/providers/gemini.ts` | Debug-only console logging in the Gemini stream parser; does not change model behavior, tokens, or control flow. `llm-provider` also sits below `reasoning` in the dependency graph (reasoning depends on it), so even if it were a mechanism it could not route through `harness-flags.ts`. |
| `RA_DEBUG_ERRORS` | `packages/runtime/src/errors.ts` | Toggles whether the full internal stack trace is preserved at the `agent.run()` error boundary vs. trimmed to one line — diagnostic verbosity, not a reasoning/harness mechanism. (Reads `REACTIVE_AGENTS_DEBUG` too, a different flag family, out of this audit's `RA_*` scope.) |
| `RA_TRACE_MAX_FILES`, `RA_TRACE_MAX_AGE_DAYS` | `packages/trace/src/recorder.ts` | Trace-file retention housekeeping (how many run files to keep, how old before pruning) — operational config with no accuracy/token lift to measure, not a default-on reasoning mechanism. |
| `RA_ABSTAIN_TASK`, `RA_ABSTAIN_DUMP`, `RA_DISC_SURFACE`, `RA_DISC_TASK`, `RA_COST_*`, `RA_RECORD_KEEP`, `RA_RECORD_ONLY`, `RA_BENCH_ALLOW_FALLBACK` | `packages/benchmarks/**` | Excluded by the standing `/benchmarks/` rule (plan Task 15, Step 2): this package legitimately reads flags directly to *construct* ablation arms — it is the harness that measures the mechanisms, not one of the mechanisms. |

## Check 9 registration and red-on-cut verification

`scripts/check-ablatable.sh` was registered as Check 9 in
`scripts/check-cross-cutting.sh` (header bumped 8→9 throughout). Red-on-cut
verified: a stray `process.env.RA_FAKE` read was added to
`packages/reasoning/src/kernel/loop/runner.ts`, `check-ablatable.sh` failed
and printed the injected line, the line was reverted, and
`check-cross-cutting.sh` was re-run to confirm **9/9**.

## Summary verdicts

- **Keep, as opt-in (unpromoted):** `RA_VERBOSE_RULES`, `RA_STABLE_TOOL_SURFACE`,
  `RA_THOUGHT_CONTINUITY`, `RA_TOOL_OBSERVE_SYMMETRY`, `RA_RATIONALE_AUDIT`,
  `RA_OVERHAUL`. None has cleared the 09 §6 lift rule; none is deleted on
  absence of evidence.
- **Keep, as default-on config/tuning (not a lift-rule mechanism):**
  `RA_RECENCY_BUDGET_CHARS`, `RA_TOOL_RESULT_BUDGET_CHARS`,
  `RA_TOT_EXPLORE_BUDGET_MS`, `RA_ASSEMBLY_DEBUG`, `RA_PROMPT_DUMP`,
  `RA_AGENT_STRICT_EGRESS`, `RA_SANDBOX`, `RA_HTTP_ALLOW_PRIVATE`.
- **Demotion candidates by the letter of 09 §7, held pending a corpus-coverage
  fix rather than executed here:** `RA_LAZY_TOOLS`, `RA_TOOL_DISCOVERY` — see
  the dedicated section above for why a same-day demotion on this evidence
  would repeat the over-confident-conclusion mistake this program exists to
  stop.
- **Needs its own review, out of this audit's scope:**
  `REACTIVE_AGENTS_EVIDENCE_DELTA_RESET` — LIVE-with-an-extra-model-call
  incidental finding, filed above, not resolved here.
- **Fixed (9 strays routed through 3 resolvers):** see "Strays found and
  fixed" above.
- **Excluded with reason (13 sites, 3 tables above):** deployment config (6),
  debug-only (3), retention housekeeping (2), benchmarks (already-standing
  exclusion, ~12 flags across ~5 files).
