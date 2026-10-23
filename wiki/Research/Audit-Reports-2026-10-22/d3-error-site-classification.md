---
type: audit
status: in-progress
created: 2026-10-23
tags: [audit, error-algebra, d3, quality-program, task-14]
---

# D3 error-site classification (quality program Task 14, Phase 1)

Companion artifact for the D3 tranche plan of
[[2026-10-22-quality-scalability-program|the Quality & Scalability Program]]
(Task 14: convert framework-internal-only `new Error` sites to
`Data.TaggedError`, riding the Task 2 ratchet down; public-identity sites are
NOT touched in Phase 1).

Metric source: raw grep of `new Error(` under `packages/**/src`, excluding
`*.test.ts` / `*.spec.ts` — comments included, exactly what
`scripts/check-string-errors.sh` counts.

## Per-package pool counts (after tranche 1)

| Package              | Pool | Notes (Phase-1 disposition) |
| -------------------- | ---- | --------------------------- |
| tools                | 64   | Public surface; Task 3 inventory shows identity consumers → Phase 2 |
| runtime              | 54   | Public rejection algebra; forbidden to touch in this tranche; Phase 2 |
| benchmarks           | 54   | PRIVATE; mostly uncaught runner throws → tranche 3 (low value) |
| runtime-shim         | 18   | Capability guards + SSRF guards; cross-package consumers un-audited → tranche 3 |
| testing              | 18   | Mock/identity surface; Phase 2 |
| llm-provider         | 16   | Public provider errors; Phase 2 |
| reasoning            | 15   | Has errors.ts + identity consumers in-kernel; Phase 2 |
| replay               | 9    | Tranche 2 (message-regex consumers verified — see below) |
| diagnose             | 10   | Tranche 2 (message-regex + `.message` renderer verified — see below) |
| ui-core / vue        | 5 / 5| Wire-protocol surface; small; audit next |
| judge-server, observe| 3 / 3| Small; audit next |
| compose, create-reactive-agent, svelte | 2 each | Audit next (create-reactive-agent is template text — likely metric-eligible but not error values) |
| a2a, observability, react, reactive-intelligence, judgment | 1 each | Audit next |
| **trace**            | **0** (was 13) | **Tranche 1 — fully converted here** |
| Total                | **287** (baseline was 300) | |

## Tranche 1: @reactive-agents/trace — 13/13 converted

New error classes live in the freshly created `packages/trace/src/errors.ts`
(the package had none). Convention call: **exported from `index.ts`** —
matching every existing package that owns an errors module (memory, tools,
llm-provider, core, reasoning all re-export error classes from their package
index; none keeps them package-private).

Throw-site precedent (repo convention for `throw`-shaped validators is
keep-throw-but-tagged): `memory/src/services/skill-portability.ts`
(`throw new MemoryError({ message })`),
`reasoning/src/kernel/utils/tool-parsing.ts` (`ToolExpressionParseError`),
`reasoning/src/kernel/state/kernel-codec.ts` (`KernelCodecError`). The two new
classes mirror the memory convention (`message` field, optional `cause`).

### Site-by-site verdict

| # | Site (pre-conversion line) | Shape | Verdict | Flow consumers checked | Message-preservation proof |
| - | -------------------------- | ----- | ------- | ---------------------- | -------------------------- |
| 1 | rationale.ts:30 | sync validator throw | **Converted** → `RationaleValidationError` | `isRationale` catch (swallow→bool, reads nothing); no repo callers (grep: only rationale.ts + index.ts export); `__tests__` suites | `{ message: "Rationale: must be an object" }` byte-identical; test asserts `.message` exact |
| 2 | rationale.ts:35 | same | **Converted** | same | byte-identical, asserted |
| 3 | rationale.ts:38 | same (template) | **Converted** | same | template rendered at construction; `(got 281)` case asserted exactly |
| 4 | rationale.ts:43 | same | **Converted** | same | byte-identical, asserted |
| 5 | rationale.ts:49 | same | **Converted** | same | byte-identical, asserted |
| 6 | rationale.ts:53 | same | **Converted** | same | byte-identical, asserted |
| 7 | rationale.ts:57 | same | **Converted** | same | byte-identical, asserted |
| 8 | rationale.ts:60 | same | **Converted** | same | byte-identical, asserted |
| 9 | rationale.ts:63 | same (template) | **Converted** | same | byte-identical, asserted |
| 10 | rationale.ts:70 | same | **Converted** | same | byte-identical, asserted |
| 11 | recorder.ts:104 | `Effect.tryPromise` catch-construction (prune daemon) | **Converted** → `TraceStorageError({message: String(e), cause: e})` | Sole consumer `errorTag(err)` → `_tag` branch (core/services/error-swallowed.ts:91) precedes the `Error`-identity fallback (:97), so the value never reaches a truth-check; value never escapes (`catchAll` swallows into `emitErrorSwallowed`) | `String(e)` applied to the SOURCE IO error, unchanged; tagged class name surfaces only as `ErrorSwallowed.tag` (was `"Error"`) |
| 12 | recorder.ts:150 | same (mkdir, flush) | **Converted** | same; this run's context HAS EventBus → real `ErrorSwallowed` event | event-level test asserts site + tag |
| 13 | recorder.ts:159 | same (appendFile, flush) | **Converted** | same | event-level test asserts site + tag |

STOP-rule screening (String-interpolation / `.name` / constructor truth):
none found for any of the 13 values. `errorTag` is the only identity-adjacent
consumer and it is `_tag`-first — the conversion is its sanctioned input
shape. Task 3 inventory lists zero `instanceof Error|*Error` occurrences in
trace, replay, diagnose, runtime-shim (the identity pool lives in
runtime/reasoning/tools/llm-provider/…).

Behavior delta (documented, intended): `ErrorSwallowed` events from
recorder.ts:150/159 now carry `tag: "TraceStorageError"` instead of `"Error"`;
the `:prune` forked-daemon fiber runs in the LAYER's own (empty) context, so
its `emitErrorSwallowed` remains a no-op there exactly as before (pre-existing
`serviceOption` design; unchanged). No repo test asserted the old `"Error"`
string (grepped all test dirs).

### Anchors added

- `packages/trace/__tests__/rationale.test.ts` — new describe with 12 cases
  (one per distinct message, both sites-30/35 double-checked) asserting
  `_tag === "RationaleValidationError"` AND byte-identical `.message`.
- `packages/trace/__tests__/recorder.test.ts` — new describe with 3 cases:
  real mkdir-EEXIST and append-EISDIR IO failures captured through an
  `EventBusLive` subscription, asserting `ErrorSwallowed.site` +
  `tag === "TraceStorageError"`; plus a direct value-contract test for the
  prune site (message preservation + `errorTag` resolution), with an
  explanatory comment for why event-level coverage is impossible there
  without out-of-scope behavior change.
- Existing `.toThrow()` cases in rationale.test.ts stay green untouched
  (tagged errors are Error subclasses; messages byte-identical).

No new test FILES were added (both extended in place) → README metrics-cache
sync was not required by the plan's rule; the docs metrics gate still passes
(see verification).

## Tranche 2 candidates (flow-verified this session, preliminary depth)

1. **diagnose (10)** — strongest remaining candidate. Verified consumers:
   `tests/diagnose.test.ts` asserts via message regexes
   (`rejects.toThrow(/Trace file not found/)`, `/cannot resolve/` analogues,
   `/grep requires a JS expression/`), and `cli.ts:140` renders
   `console.error(\`Error: ${(err as Error).message}\`)` — `.message`-only, so
   byte-identical tagged messages keep every consumer green. The 5 `cli.ts`
   arg-guard sites have no covering tests → tranche-2 must add direct
   message+`_tag` cases. No instanceof in package.
2. **replay (9)** — 7 of 9 sites are `Effect.die(...)` DEFECT-channel values
   (tool-layer:6/22/44, llm-layer:82 `missError` helper feeding only die
   consumers, llm-layer:119/123/125): tests assert `rejects.toThrow(/unrecorded/i)`
   and `/no recorded exchange/i` message substrings which would survive a
   byte-identical tag, but Cause pretty-printing changes (class-name header)
   and `missError`'s declared return type `Error` would become the tagged
   class. Whether DEFECTS should be tagged at all is a Task-15-style decision,
   not a silent tranche edit. The 2 `load.ts` sync throws (30/53) flow to
   message-regex tests (`rejects.toThrow(/cannot resolve/)`) + the diagnose
   CLI `.message` renderer — those are clean tranche-2 conversions if the
   team wants replay in Phase 1.
3. **ui-core (5), observe (3), judge-server (3), small remainder (a2a,
   observability, react, svelte, vue, judgment, compose, reactive-intelligence:
   1–5 each)** — not yet flow-audited; each likely 1–2 internal sites + public
   identity sites to classify.

## Tranche 3 / Phase 2 (out of D3-Phase-1 scope)

- **runtime-shim (18)** — capability guards (`!Bun` throws) and the 9
  `assertPublicUrl` SSRF throws are consumed cross-package by
  `tools/skills/http-client.ts` (no local catch → propagates to the tool
  boundary renderer), `a2a/client/discovery.ts` (propagates to public A2A
  client), and `runtime/src/builder/build-effect/remote-agent-tools.ts`
  (runtime is Phase-2 territory). Renderers not yet verified to be
  `.message`-only; `String(err)` at any boundary would change text (tagged
  classes render `ClassName: msg`). STOP until consumer audit lands.
- **benchmarks (54)** — private package, runner throws mostly uncaught (human
  stack text); low conversion value, no test anchors for most sites. Drain via
  Task 2's opportunistic file-touch rule.
- **tools (64) / runtime (54) / llm-provider (16) / reasoning (15) /
  testing (18)** — heavy public rejection identity + the Task 3 instanceof
  concentration. These are the audit's "public-identity sites": NOT Phase 1.

## Ledger

`scripts/check-string-errors.sh`: `STRING_ERRORS_BASELINE` 300 → **287**
(13 sites, attributed edit-history entry dated 2026-10-23).
`INSTANCEOF_BASELINE` untouched at **129** — this tranche added zero
`instanceof` literals (script verified: pool still exactly 129; git diff
grep: zero added occurrences of `instanceof (Error|[A-Za-z]*Error)` or
`new Error(` anywhere, test comments included).

## Verification record (2026-10-23, tree @ 7bc61c368 + tranche-1 edits)

- `bash scripts/check-string-errors.sh` →
  `✅ check-string-errors: 287 string-throw sites at baseline 287; 129 instanceof sites at baseline 129.`
- `for s in scripts/check-*.sh; do bash "$s" >/dev/null || echo RED; done` → zero RED
- `bunx tsc --noEmit -p packages/trace` + consumers
  (reasoning, benchmarks, diagnose, reactive-intelligence, replay, runtime,
  testing) → all rc=0 (trace dist built first via `turbo run
  build --filter=@reactive-agents/trace`; core/observability dists came with it)
- `bun test packages/trace/ --timeout 20000` → 90 pass pristine → **105 pass / 0 fail** (15 added)
- `bun test packages/reasoning/ --timeout 20000` → pristine 3197 pass / 4 todo / 0 fail → **3197 / 4 / 0 fail** (371 files; expect-count 11023→10937 run-to-run variance from conditional assertions, test counts identical)
- `bun test packages/replay/ packages/diagnose/ --timeout 20000` → **75 pass / 0 fail** (extra insurance beyond gates; not separately baselined — no pristine run of these was required, both consume trace and stayed green)
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` → **2 pass / 0 fail**
- `bunx turbo run typecheck --filter=reactive-agents --filter=@reactive-agents/react --filter=@reactive-agents/benchmarks` → **29/29 successful**
