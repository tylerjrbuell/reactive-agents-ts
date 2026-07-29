# Rung 1 — flag inertness sweep (2026-07-28)

Zero tokens, no provider, no keys. `packages/benchmarks/src/replay-ablate-sweep.ts`
replays the committed golden corpus once per behavioural flag against a FIXED
recorded LLM table and reports whether control flow diverged. This measures
**control flow only** — not accuracy, not cost, not prompt content. It cannot
re-baseline the retracted token-overhead figure, and a LIVE verdict here is not
a lift result.

## Baseline status: DIRTY on first run, resolved by exclusion (not by fixing the bug)

First run:

```
baseline: 4/5 goldens match  ← NOT CLEAN, verdicts below are unattributable
```

Investigated with `bun run packages/benchmarks/src/replay-ablate.ts --baseline`
directly. The single divergent cell is `planned-tool-loop`:

```
"golden": "planned-tool-loop", "ok": false, "dispensed": 3, "tableSize": 3,
"failure": "tool-sequence divergence: [{\"kind\":\"removed\",\"toolName\":\"file-write\",
\"argsHash\":\"319affce67dcacdb\",\"atIndex\":0},{\"kind\":\"added\",\"toolName\":\"...\"
```

This is **exactly** `wiki/Architecture/DEBT-REGISTER.md` **D-2026-07-28-D**: the
plan-execute replay-lane `argsHash` divergence. `step-executor.ts` stores
PRE-heal (relative) tool args in the ledger; the observability trace records
POST-heal (absolute) paths for the same call; `replay-agent.ts`'s
`toolCallsFromResult` hashes the pre-heal args with no reconciliation. Every
`plan-execute-reflect` golden with path-taking tools diverges from its own
trace on every tool call, regardless of any env flag —
`packages/benchmarks/tests/replay-lane.test.ts` hits the identical failure mode
and already carries a `KNOWN_ARGS_HASH_DIVERGENCE` skip-set for this exact
golden. It is **not** a newly-introduced flakiness or a corpus-noise artifact:
it is the same pre-existing, flag-independent bug affecting both consumers of
this golden identically.

**Fix applied, scoped to this task only:** added a matching
`KNOWN_ARGS_HASH_DIVERGENCE` exclusion set inside
`replay-ablate-sweep.ts` (mirroring the test file's own convention) that drops
`planned-tool-loop` from both the baseline-clean check and every per-flag
divergence check, with a comment pointing at D-2026-07-28-D. This does **not**
touch `step-executor.ts` or `replay-agent.ts` — reconciling the argsHash
mismatch is the debt entry's own separately-scoped discharge task, explicitly
out of scope here. Re-run:

```
baseline: 4/4 goldens match  (excluded planned-tool-loop — known argsHash divergence, D-2026-07-28-D)
```

Baseline is clean on the 4 attributable goldens (`abstain`, `answer-only`,
`terse-tool-loop`, `tool-write`). Every verdict below is attributable to its
flag on those 4 goldens. `planned-tool-loop` (the only golden that exercises
`plan-execute-reflect` and multi-step path-taking tool calls) contributes
**zero** signal to this sweep until D-2026-07-28-D is discharged — that is a
real coverage gap, not a false negative, and is called out per-flag below
where it matters.

## Full sweep output

```
baseline: 4/4 goldens match  (excluded planned-tool-loop — known argsHash divergence, D-2026-07-28-D)
  ✦  REACTIVE_AGENTS_EVIDENCE_DELTA_RESET=1 — LIVE on 1/4
       terse-tool-loop: 4/4 output mismatch: recorded "wrote and re-read the log, it is done." vs replay "Strategy execution failed: Error: replay: no recorded exchange
  ·  REACTIVE_AGENTS_NOOP_VERIFIER=1 — no divergence on 4 goldens
  ·  REACTIVE_AGENTS_LAZY_VALIDATION=1 — no divergence on 4 goldens
  ·  RA_LAZY_TOOLS=0 — no divergence on 4 goldens
  ·  RA_TOOL_DISCOVERY=0 — no divergence on 4 goldens
  ·  RA_VERBOSE_RULES=1 — no divergence on 4 goldens
  ·  RA_STABLE_TOOL_SURFACE=1 — no divergence on 4 goldens
  ·  RA_THOUGHT_CONTINUITY=1 — no divergence on 4 goldens
  ·  RA_TOOL_OBSERVE_SYMMETRY=1 — no divergence on 4 goldens
  ·  RA_RATIONALE_AUDIT=1 — no divergence on 4 goldens
  ·  RA_OVERHAUL=1 — no divergence on 4 goldens
  ·  RA_AGENT_STRICT_EGRESS=1 — no divergence on 4 goldens
  ·  REACTIVE_AGENTS_DISABLE_STATUS_MODE=true — no divergence on 4 goldens
  ·  RA_RECENCY_BUDGET_CHARS=200 — no divergence on 4 goldens
  ·  RA_TOOL_RESULT_BUDGET_CHARS=100 — no divergence on 4 goldens
  ·  RA_ASSEMBLY_DEBUG=1 — no divergence on 4 goldens
  ·  RA_PROMPT_DUMP=1 — no divergence on 4 goldens

UNTESTABLE on this corpus (5) — NOT evidence of inertness:
  ⊘  REACTIVE_AGENTS_MAX_ITERATIONS — shadowed — every sidecar sets maxIterations, and builder.ts:263 reads the env var only as a DEFAULT
  ⊘  REACTIVE_AGENTS_MAX_RECURSION_DEPTH — unexercised — read in agent-tool-adapter; no golden delegates. Needs a sub-agent golden
  ⊘  RA_TOT_EXPLORE_BUDGET_MS — unexercised — tree-of-thought only; every golden runs `reactive`
  ⊘  RA_HTTP_ALLOW_PRIVATE — unexercised — network egress; no golden makes an HTTP call
  ⊘  RA_SANDBOX — unexercised — compares against "docker" and needs a live daemon

LIVE       (1): REACTIVE_AGENTS_EVIDENCE_DELTA_RESET
INERT      (16): REACTIVE_AGENTS_NOOP_VERIFIER, REACTIVE_AGENTS_LAZY_VALIDATION, RA_LAZY_TOOLS, RA_TOOL_DISCOVERY, RA_VERBOSE_RULES, RA_STABLE_TOOL_SURFACE, RA_THOUGHT_CONTINUITY, RA_TOOL_OBSERVE_SYMMETRY, RA_RATIONALE_AUDIT, RA_OVERHAUL, RA_AGENT_STRICT_EGRESS, REACTIVE_AGENTS_DISABLE_STATUS_MODE, RA_RECENCY_BUDGET_CHARS, RA_TOOL_RESULT_BUDGET_CHARS, RA_ASSEMBLY_DEBUG, RA_PROMPT_DUMP
UNTESTABLE (5): REACTIVE_AGENTS_MAX_ITERATIONS, REACTIVE_AGENTS_MAX_RECURSION_DEPTH, RA_TOT_EXPLORE_BUDGET_MS, RA_HTTP_ALLOW_PRIVATE, RA_SANDBOX
```

## The four flags this task cares about

| Flag | Value | Verdict | Notes |
|---|---|---|---|
| `RA_LAZY_TOOLS` | `0` | **INERT** | Pre-existing row, re-run for comparison. No divergence on the 4 attributable goldens. |
| `RA_TOOL_DISCOVERY` | `0` | **INERT** | New. No divergence — none of the 4 attributable goldens' `builtins` sets are large enough that turning discovery off (leaving pruning on) causes a call to a pruned-but-undiscovered tool. |
| `RA_VERBOSE_RULES` | `1` | **INERT** | New. No divergence — the verbose RULES block is a prompt-only addition; see scope-limit discussion below. |
| `RA_STABLE_TOOL_SURFACE` | `1` | **INERT-with-caveat, see below** | New (F10). Bucketed INERT by the sweep, but do **not** read this the same way as the other 15 INERT rows — see analysis. |

### Why `RA_TOOL_DISCOVERY` / `RA_VERBOSE_RULES` are genuinely INERT here, not silently mis-toggled

Verified against `packages/reasoning/src/harness-flags.ts` before adding rows,
per the file's own warning about wrong-polarity false-INERTs:

- `toolDiscoveryEnabled()` — default ON, `!isOff(...)`. `RA_TOOL_DISCOVERY=0` is
  the correct ablation (turns discovery off alone, leaving pruning intact).
- `verboseRulesEnabled()` — default OFF, explicit override wins.
  `RA_VERBOSE_RULES=1` is the correct ablation (asks for the block directly).

Both toggles are in the correct direction. The INERT verdict is a genuine
"ran, no control-flow divergence on this corpus" result, not a polarity bug.
`RA_VERBOSE_RULES` in particular is expected to be corpus-invisible under
replay by construction — it only adds text to the system prompt, and replay
answers from a FIXED recorded table rather than asking a live model to react
to a changed prompt (see replay-ablate.ts's own scope-limit comment: "A
mechanism that changes the PROMPT ... which a fixed table cannot simulate").
`RA_TOOL_DISCOVERY` is a genuine mechanism the corpus *could* show live if a
golden depended on the `discover-tools` meta-tool to surface a
pruned-but-permitted tool; none of the 4 attributable goldens do (they all
have small, fully-required `builtins` lists that are never pruned out of
view in the first place).

### `RA_STABLE_TOOL_SURFACE` — the plan predicted LIVE, the sweep measured INERT. Investigated; not force-fit to the prediction.

Task 7's own text expected: *"Expect `RA_STABLE_TOOL_SURFACE` to report live
(it changes the visible tool set, which changes the prompt)."* The actual
measurement is INERT. Investigated rather than assumed:

Read `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts:285-294`.
When `stableToolSurfaceEnabled()` is true, `visible`/`callable` becomes the
**full permitted tool surface minus only the contract deny-list and
gate-blocked tools** — i.e. a strict *superset* of whatever narrower,
lazily-pruned set produced the recording. Every one of the 4 attributable
goldens (`abstain`, `answer-only`, `terse-tool-loop`, `tool-write`) has a
small `builtins`/`requiredTools` list where nothing is ever pruned out of
view under baseline lazy disclosure either — so there is no golden in this
corpus where a call succeeds under the wide surface but would have been
rejected (and triggered a corrective-observation retry) under the narrow one.
Since replay dispenses the model's actions from a FIXED table regardless of
what the constructed request's `tools` array looks like, and the only way
this flag could change *control flow* (as opposed to prompt bytes) is by
changing whether a recorded call gets accepted or rejected at the harness
layer, a corpus where no recorded call is ever rejected under the narrow
surface cannot show divergence for this flag **no matter how many times it's
re-run**. This is structurally different from the other 15 INERT rows: it is
not "ran and did nothing," it is "ran, and the only channel through which it
could show up in a replay-based control-flow diff is not exercised by any
committed golden."

**Verdict: do not treat as a demotion/deletion candidate on this signal.**
Recorded as INERT in the raw sweep output (the tool has no fourth bucket), but
functionally belongs with the UNTESTABLE list: exercising it for real requires
either (a) a golden where the recorded trajectory includes a
disclosure-narrowing rejection/corrective-retry, or (b) a live arm, which is
exactly what `disclosure-ablation.ts`'s `stable-surface` arm (Task 10) is for.
This does not change the corpus-growth backlog item, just clarifies it: growing
the corpus with a "calls a permitted-but-pruned tool" golden would let this
sweep actually test the mechanism instead of trivially passing it through.

### `RA_LAZY_TOOLS` (pre-existing row) — re-confirmed INERT

No divergence on the 4 attributable goldens, consistent with the prior sweep.
Same reasoning as `RA_TOOL_DISCOVERY` above (this corpus never needs pruning
narrow enough to exclude a required tool), plus `RA_VERBOSE_RULES`'s
prompt-only limitation, since disabling `RA_LAZY_TOOLS` flips both at once.

### Incidental finding: `REACTIVE_AGENTS_EVIDENCE_DELTA_RESET=1` is LIVE

Not one of this task's three flags, but worth flagging since it surfaced in
this run: LIVE on `terse-tool-loop`, with the replay throwing `"replay: no
recorded exchange"` — the mechanism causes the harness to make an additional
model call beyond what was recorded (table exhaustion), i.e. it changes
iteration count on this golden. Out of scope for Task 7 to act on; noted for
the audit in Task 15.

## Coverage gap this baseline exclusion leaves open

Excluding `planned-tool-loop` means **no flag in this sweep was exercised
against a `plan-execute-reflect` golden** in this run — the corpus currently
has exactly one such golden and it's the one with the known bug. Discharging
D-2026-07-28-D (or adding a second, healthy plan-execute golden) would restore
that coverage; tracked in the debt entry, not duplicated here.

## Summary table

| Flag | Verdict | Safe to demote/delete on this signal alone? |
|---|---|---|
| `RA_LAZY_TOOLS=0` | INERT | Yes, per corpus (grow corpus first per the tool's own rule) |
| `RA_TOOL_DISCOVERY=0` | INERT | Yes, per corpus |
| `RA_VERBOSE_RULES=1` | INERT | No — prompt-only mechanism, replay structurally can't see it; needs a live arm before any deletion talk |
| `RA_STABLE_TOOL_SURFACE=1` | INERT (bucketed) / functionally untestable | No — corpus has no golden that can expose it; treat as untestable, not as a deletion candidate |

Replay measures control flow, not accuracy and not cost. This sweep is not a
lift result for any of these four flags.
