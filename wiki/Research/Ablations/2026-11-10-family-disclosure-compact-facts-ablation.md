---
type: ablation
status: complete
created: 2026-11-10
tags: [ablation, lift-gate, tool-surface, lazy-disclosure, compact-profile, verifier, claimed-action, measurement, reject, opt-in]
---

# Ablation: named-family disclosure (4) and compact call-constraint notes (5). Verdicts: (4) REWORK, (5) OPT-IN

Both changes shipped default-on without measurement. This note measures them on grok-4 (xAI) and mimo-v2.6 (Ollama, `num_ctx` 16384 and 8192). It also audits two new verify checks on the same runs. Follow-up to [[2026-11-10-stable-tool-list-ablation]] (defects 2, 4, 5 and the conversion half of 1 there). Scripts, receipts and results: [2026-11-10-family-disclosure-compact-facts/](2026-11-10-family-disclosure-compact-facts/).

## Verdicts

Coded gate (`evaluateLiftGate`, `DEFAULT_LIFT_POLICY`). Ollama tiers are token-free, per the 2026-11-06 owner ruling. Both ledger entries are written (entries 41 and 42 in `wiki/Research/Harness-Reports/improvement-ledger.json`).

**(4) Named-family lazy disclosure** (`namedToolFamily`, `NAMED_FAMILY_CAP` = 12). Candidate = shipped default; baseline = `namedToolFamily` returns `[]`. Receipt: `gate-receipt-family.txt`.

```
  tier                 base    cand      lift       tok  verdict
  grok-4               30.0     0.0   -30.0pp     -3.5%  REGRESS
  mimo-v2.6@16384      54.2    75.0   +20.8pp     +7.1%  BELOW
  mimo-v2.6@8192       45.8    75.0   +29.2pp     +9.6%  BELOW
  DECISION: REJECT · 3 tier(s) · 6.7pp lift · 4.4% billed tok — a tier significantly regresses
```

**(5) Compact-profile call-constraint notes** (`callConstraintNote` + enum values in place of the type). Candidate = shipped default; baseline = the note returns `""` and enums render as `p.type`. Receipt: `gate-receipt-constraint.txt`.

```
  tier                 base    cand      lift       tok  verdict
  mimo-v2.6@16384      64.6    87.5   +22.9pp     -6.2%  BELOW   (umami +37.5 ± 23.7; h3-required-tools +8.3 ± 16.9)
  mimo-v2.6@8192       33.3    75.0   +41.7pp    +24.2%  BELOW
  DECISION: OPT-IN · 2 tier(s) · 32.3pp lift · 9.0% billed tok — below the promotion bar
```

**Recommendations**
- **(4) REWORK.**
  - On grok-4 the mechanism did the opposite of its purpose. With 12 umami tools shipped on turn 0, grok-4 listed the tools as a menu and asked the user in **10 of 10** runs (score 0).
  - With the change off, 5 of 10 runs called `discover-tools` and explored (mean score 0.30).
  - The mimo gains are real in direction but sit within the 95 % band. On mimo they come only from a side effect: the change moves `umami_get_metrics` into the visible set, which is how the (5) note reaches the wire (see "Interaction").
  - Do not keep it default-on in its current form. The parent and kernel-warden decide the flip; I do not flip defaults.
- **(5) OPT-IN by the code.**
  - Both local tiers lift, and the lift is significant at 1σ: +22.9 pp and +41.7 pp.
  - Neither clears the 95 % band. On mimo@16k the between-task term (umami +37.5, h3-required-tools +8.3) blocks promotion, and more runs cannot shrink that term. Only more tasks where the note activates could.
  - It is inert on grok-4 by construction: only the `local` profile is compact (`context-profile.ts:146`).
  - Honest read: the note restores data that the compact profile used to delete. Every measured sign is positive and nothing regressed. The code still says OPT-IN, and the code wins. Promoting it needs a third activated task family, or a frontier-tier activation (there is none today), and a re-gate.

## Setup

- **Building the arms without editing `packages/*/src`.** Neither change has a switch. A Bun preload plugin, `arm-plugin.ts`, builds them in memory:
  - It serves every `packages/<pkg>/src/**/*.ts` from a frozen copy of the tree (taken 2026-11-10T19:27:34-05:00; 1,542 `.ts` files).
  - It patches `attend/tool-formatting.ts` per arm. `nofam`: `namedToolFamily` returns `[]`. `nocon`: `callConstraintNote` returns `""` and enum params render as `p.type`.
  - Each patch must match exactly once, or the process aborts.
  - This reproduces the pre-change code exactly. Per the `git diff`, both call sites in `think.ts` set the description to `""` before the change.
  - All arms ran the same frozen tree, so other wardens' edits during the run could not split the arms.
- **Instrument note.** Under Bun every `@reactive-agents/*` import resolves to `packages/<pkg>/src` through the root `tsconfig` paths. That includes `reasoning`, even from `packages/benchmarks` and `packages/runtime`. AGENTS.md pitfall 8 ("reasoning exports dist; src edits are invisible until build") does not hold for these scripts. The `reasoning` rebuild before the first cell was a full-turbo cache hit, and it was irrelevant.
- **Arms per process.** Each process runs one arm; the shell alternates arms per run index. Tiers:
  - `grok-4`: static capability.
  - `mimo-v2.6`: capability primed from `/api/show`, with explicit `numCtx` through `.withModel({ model, numCtx })`.
- **Tasks.**
  - `umami-explore` (20 umami-style tools; prompt "Help me explore analytics for my docs site in umami."). Task definitions and scoring are copied unchanged from the previous ablation's `run-wide.ts`. Score = 3 tool-only facts present in the output the caller received.
  - `h3-required-tools` (frozen H3) for (5).
  - `wide-metric`, base arm only, for the claimed-action audit.
- **Runs.** k = 10 per arm on grok-4 `umami-explore`. k = 8 per arm on every mimo cell. k = 3 (grok) and 5 (mimo, each ctx) on `wide-metric`. Timeouts: 0 cells.
- **Git state.** HEAD `69aa37a6a`, dirty tree (about 420 files; runtime-warden and cortex-warden were editing). The frozen copy pins it. Raw traces: `results/traces-*`.

### Trigger census (zero-token, before any cell): `census.ts`, `census-meta.ts`

- **(4)** fires on `umami-explore` only: 12 of 20 tools, `umami_create_report` included, `delete_`/`reset_` not. It fires on 0 of 12 H3 tasks: H3 tools are hyphenated builtins, which have no family key. It fires 0 times on `wide-metric`: no prefix with two or more members is named in the prompt.
- **(5)**
  - Among builtins and meta tools it changes only `code-execute` ("language: Either value runs the same way…" plus the enum `javascript|typescript`).
  - On H3 that means `h3-required-tools` alone. The other 11 H3 tasks are byte-identical across arms, so they were not run.
  - Off H3 it also changes `relate`, `request_user_input`, `rag-ingest` and `docker-execute`, which no measured task offers.
  - It changes `umami_get_metrics` (`type is one of url, referrer, …`).
- The rest of the H3 gate suite was not run: both mechanisms are provably inert there, so A/B cells would measure pure noise.

## Tool surface per arm (turn 0, `guard-fired wire-request` `toolsShipped`; read before any token figure)

Full lists: `facts-all.txt`.

| Tier | Task | base (both on) | nofam | nocon |
|---|---|---|---|---|
| grok-4 | umami-explore | 13: 12 umami (`get_websites`…`get_teams`, incl. `create_report`) + `discover-tools` | 2: `umami_get_websites`, `discover-tools` | not run (inert) |
| mimo (16k, 8k) | umami-explore | 21 (all 20 + `recall`); visible 12 | 21; visible **1** | 21; visible 12 |
| mimo@16k | h3-required-tools | 4: `file-read, file-write, code-execute, recall` | | same 4 |
| grok-4 / mimo | wide-metric | 12 / 41 | | |

On mimo, (4) does not change the wire list: `toolIndex` promotes hidden tools onto the wire. It changes which tools are **visible**, and that decides which description each schema carries (next section).

## Interaction: on mimo, (5) only reaches the model through (4)

- The two wire paths trim descriptions differently:
  - A **visible** tool in a compact profile gets `description = callConstraintNote(tool)` (`think.ts`).
  - A hidden tool **promoted by `toolIndex`** gets the description's first sentence (`buildToolIndexCallableSchemas`, `reason/tool-index-disclosure.ts:72-74`).
- For `umami_get_metrics` the first sentence is "Get ranked metrics for a website." The constraint is in the second sentence, so the promoted path drops it.
- `umami-args.txt`, from ledger `tool-invocation` args:

| mimo tier | arm | runs with ≥1 invalid `type` | runs with ≥1 valid `type` | invalid values |
|---|---|---|---|---|
| 16k | base | 0 / 8 | 8 / 8 | none |
| 16k | nofam (note on, tool hidden) | 8 / 8 | 5 / 8 | `pageviews` ×8; one run (run 4) made 180 `get_metrics` calls, 178 with invented types (`visitors_per_unique_visitor_per_session`…), 92 s |
| 16k | nocon | 8 / 8 | 0 / 8 | `pageviews` ×8, `visitors`, `visits`, … |
| 8k | base | 0 / 8 | 8 / 8 | none |
| 8k | nofam | 8 / 8 | 5 / 8 | `pageviews` ×8 |
| 8k | nocon | 8 / 8 | 0 / 8 | `pageviews` ×8 |

- The note fixes invalid arguments completely, but only when the tool is visible.
- The (4) "lift" on mimo is this effect, not better discovery: the wire list is identical in both arms.
- **Defect (kernel, report to kernel-warden).** There are two description trimmers for one failure class. `buildToolIndexCallableSchemas` should keep `callConstraintNote` sentences, as the compact path does. Then (5) works without (4).

## Outcomes and cost

| Tier | Task | Arm | n | score | asked the user | write/delete called unasked | iters | tokens in+out | LLM median ms | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| grok-4 | umami | base | 10 | **0.00** | **10** | 0 | 2.0 | 2,768 | 4,810 | 9.0 |
| grok-4 | umami | nofam | 10 | 0.30 | 5 | 0 | 2.9 | 2,868 | 3,520 | 11.5 |
| mimo@16k | umami | base | 8 | 0.75 | 0 | 0 | 4.4 | 8,674 | 2,602 | 18.2 |
| mimo@16k | umami | nofam | 8 | 0.54 | 0 | 0 | 4.0 | 8,101 | 3,840 | 25.9 |
| mimo@16k | umami | nocon | 8 | 0.38 | 0 | 0 | 3.9 | 6,938 | 2,597 | 16.8 |
| mimo@8k | umami | base | 8 | 0.75 | 0 | 0 | 4.1 | 8,041 | 3,105 | 17.8 |
| mimo@8k | umami | nofam | 8 | 0.46 | 0 | 0 | 3.9 | 7,338 | 3,498 | 17.7 |
| mimo@8k | umami | nocon | 8 | 0.33 | 0 | 0 | 3.5 | 6,475 | 3,502 | 14.7 |
| mimo@16k | h3-required-tools | base | 8 | 1.00 (8/8 solved) | 0 | 0 | 5.5 | 6,344 | 1,166 | 11.8 |
| mimo@16k | h3-required-tools | nocon | 8 | 0.92 (6/8) | 0 | 0 | 6.1 | 9,073 | 1,308 | 20.6 |

- **Asked the user.** The final answer ends on a question or menu, and no data tool ran beyond `get_websites` or discovery. The regex was checked by hand against all 20 grok-4 outputs. All 10 grok-4 base answers enumerate the family's capabilities back to the user ("Which of these would you like to start with?"). All are recorded `success` / `model-final`, so the harness accepts a clarifying menu as a finished run.
- **Write/delete tools.** None was called in any arm on any tier. That holds even though grok-4 base ships `umami_create_report`, and mimo ships `create_website`, `update_website`, `delete_website` and `reset_website` in every arm.
- **Tokens.** (4) costs grok-4 nothing extra per run (−3.5 %): the run is shorter, which offsets the bigger schema list. (5) on mimo@8k is +24 % tokens (token-free tier), because runs with valid `type` values do more work.
- **Invalid-argument errors.** The `umami_get_metrics` mock answers an unknown `type` with data, not an error. So invalid arguments are counted from the call args (table above), not from tool errors.

## Verify-check audit (same runs; both checks are on in every arm)

Receipt: `audit-scan.txt`. Classification by reading each output against the tool values (`totaltime` 611,400 s; 5,207 visits; 3,912 visitors).

### Unbacked claimed action (`output-not-unbacked-action-claim`, exit-gate outstanding)

| | Count |
|---|---|
| Exit-gate denials | 6 (mimo `wide-metric`: 4 at 16k, 2 at 8k) |
| True positive (`report_file` had not run when "I've filed a report…" was proposed) | **6** |
| False positive (the tool had already succeeded) | **0** |
| Denied run then called the tool and finished `success` | 6 of 6 |
| Terminal-verifier rejections | 0 (the exit gate caught every case first) |
| Unbacked claim accepted (false negative) | 0 seen: every `wide-metric` run, 13 of 13, called `report_file` |

Before/after (not an A/B: the check has no switch, and the build differs). The previous ablation had 12 of 20 mimo `wide-metric` runs claim the report without filing it. Here it was 0 of 10.

### Unit conversions (`output-not-fabricated-measurement` with `measurement-conversion.ts`)

| Class | Runs | Examples |
|---|---|---|
| Correct conversion **accepted** | most mimo runs | "10,190 min", "169.8 hours", "170 hours", "117 s per visit", "117.4 s" |
| Correct conversion **rejected** (false positive) | **0** | |
| Wrong conversion **rejected** (true positive) | 7 | "172.6 hours" ×6 (true value 169.8), "1019 minutes" ×1 (true value 10,190) |
| Borderline rejection | 1 | "~118 seconds of time per visit" (true value 117.4; integer rounding says 117). The check is strictly right, but the run fails over 0.5 s next to a correct "169.8 h" |
| Wrong conversion **accepted** (false negative) | **22 runs** of 48 mimo `umami` runs | "~172 hours" ×11, "≈167 hours" ×4, "~272 hours", "~172.6 h" ×2, "1,019 min", "~1,640 min", "117.4 **min**" per visit, "~11.7 minutes per visitor" (true value 2.6), "≈7.4 days" (true value 7.08) |

- The conversion fix removed the false positives the previous ablation reported: correct "10,190 minutes" and "169.8 hours" now pass.
- Recall on wrong conversions is now about **24 %** (7 of 29 wrong-conversion runs caught). The misses share a shape: a hedged value (`~`, `≈`) or a short unit (`h`, `min`).
- I cannot tell from these runs whether the hedge/short-unit pass-through is new or older. Report to the verification owner: test hedged and abbreviated forms against the conversion tolerance.

## Harness defects found (report to the owning wardens; not fixed here)

1. **Tool-index promotion strips call constraints** (kernel). `buildToolIndexCallableSchemas` keeps only the first sentence, so `callConstraintNote` never reaches promoted schemas. Mechanism (5) only works on local tiers when (4) happens to make the tool visible. Fix at the boundary: one compact-description function for both paths.
2. **Family disclosure makes grok-4 ask instead of act** (kernel, tool surface): 10 of 10 runs, against 5 of 10 without it. Hypothesis, not tested: a visible 12-tool family reads as a menu to offer; `discover-tools` alone invites exploration.
3. **A clarifying menu is accepted as `success` / `model-final`** (runtime/verification, outcome truth). All 15 grok-4 "asked the user" runs end `success`. For chat that may be fine. As a task outcome it is not a delivery.
4. **Measurement check misses hedged or abbreviated wrong conversions** (verification): 22 of 29 wrong-conversion runs accepted.
5. **Instrument gaps.**
   - The trace records shipped tool **names** (`toolsShipped`, `toolSchemaNames`) but not the wire **descriptions**. The interaction in defect 1 had to be shown statically and through call args.
   - `tool-surface-resolved.visible` is not the wire list on `toolIndex` tiers (repeat of the previous ablation's defect 6).
6. **Stale contributor doc.** AGENTS.md pitfall 8 / MEMORY ("`packages/reasoning` exports dist") does not hold for Bun scripts run in this repo: root `tsconfig` paths resolve `src`.

## Not proven

- One task carries (4) and the umami half of (5). Mimo at 16k and 8k is one model. The code counts them as two tiers.
- The gate's per-cell SE is about 24 pp at n = 8. Only the grok-4 regression (−30 pp, 0 of 10 explored) and the invalid-argument effect (8 of 8 vs 0 of 8 per cell) are large enough to read with confidence.
- (5) has no frontier-tier activation, so its frontier effect is zero by construction, not by measurement.
- The audit classifications are mine, made from reading transcripts against known tool values. The 22 false negatives are counted per run, not per figure.
