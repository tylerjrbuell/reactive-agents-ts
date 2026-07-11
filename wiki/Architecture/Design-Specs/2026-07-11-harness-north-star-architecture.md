---
tags: [harness, architecture, north-star, dx, termination, measurement, design-spec]
date: 2026-07-11
status: proposed
builds-on:
  - "[[08-AGENTIC-OS-NORTH-STAR]] (v6.0, ratified 2026-07-05 — program direction, unchanged)"
  - "[[2026-07-07-ideal-harness-architecture]] (9-pillar centralization, ratified)"
  - "wiki/Research/Audit-Reports-2026-07-10/measurement-layer-teardown.md"
  - "wiki/Planning/Implementation-Plans/2026-07-10-goal-reliability-and-feedback-loop-program.md"
  - "wiki/Planning/Implementation-Plans/2026-07-10-harness-root-cause-closure-program.md"
---

# Harness North-Star Architecture — how the harness should function

**Owner question:** "Determine the way the harness should function ideally to provide best
overall performance and the best architecture to build highly effective, flexible and
controllable agents with a fantastic DX."

**Scope:** This spec REFINES North Star v6.0 (the Agentic OS program — arcs, launch line,
honest-claims law all stand) and the 07-07 nine-pillar spec (one loop / one gateway / one
ledger / one gate / one control plane — all stand). It adds the layer both left implicit:
**what the harness's authority model is, what its DX is, and what "done" means for a run.**
Every position is grounded in this repo's verified session evidence and tagged
**[RATIFY]** (needs owner sign-off — changes defaults, authority, or public surface) or
**[BUILD]** (engineering can proceed under existing ratified direction). Claims I could
not verify in repo or wiki are tagged **[UNVERIFIED]**.

**The one-sentence answer:** the harness is an *evidence-driven completion machine* — it
compiles the goal into uneditable acceptance criteria, runs one loop that recites what
remains, treats every heuristic as advice and every deterministic fact as law, terminates
only on criteria-exhaustion / budget / honest abstention, and returns a receipt that says
exactly what it did to the run and why — reachable in five lines of user code.

---

## 1. Control authority — one completion authority, one signal envelope

**Disease (verified):** termination is polyphonic. The arbitrator exits on content
stability (`normalizedLevenshtein(current, prior) > threshold`,
`packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts:313-314`) and on a
final-answer regex (`arbitrator.ts:372-376`, reason `final_answer_regex`) — **both with
zero goal evidence**. The goal-reliability program's B-list confirms no termination path
checks goal semantics (B1: verifier self-describes as grounding/structure only,
verifier.ts:26; the one semantic requirement at run-contract.ts:279 has no condition and
its only judge, the P6b checker at terminal-gate.ts:280, has zero callers). Empirical
receipt: rw-7 × cogito:8b × n=5 → solved 0/5, honesty=claimed-success 5/5, pass^1 = 0
(goal-reliability plan §"Empirical baseline"). Variance enters structurally: same goal,
different pacing → different termination path, none goal-checked.

**Position [RATIFY] — THE completion authority is `resolveCompletionStatus` over the
contract evidence ledger, invoked from the single-owner terminal gate (`terminate.ts`).**
Nothing else may *decide* a run is complete. Everything else — content stability,
final-answer regex, LLM end-turn, reflect verdicts, worker success, code-exec exit —
becomes a **candidate-answer proposal** routed INTO that authority, never an exit around
it. This generalizes the ratified single-owner-terminate invariant from "one function
owns the terminal transition" to "one function owns the *meaning* of completion."

**Position [BUILD] — the signal-boundary primitive: `CompletionEnvelope`.** A single
typed record that MUST cross every strategy/sub-kernel boundary:

```
CompletionEnvelope {
  completionStatus,            // completed | partial | abstained | failed
  harnessAuthoredOutput,       // did the harness synthesize the deliverable?
  budgetTerminalPartial,       // terminated by budget, not by evidence
  verificationWarning,
  abstention,
  outstandingCriteria[],       // what the contract still lacks
  evidenceRefs[]               // ledger entries backing each satisfied criterion
}
```

Today `ReactKernelResult` (react-kernel.ts, return block ~:256-268) carries
`finalAnswerCapture` and `abstention` but **drops `meta.harnessAuthoredOutput` /
`budgetTerminalPartial` / `verificationWarning`** (grep: zero occurrences in the file) —
the exact #40 blocker. Consequence: H5 completion honesty reaches only strategies whose
terminal is a KernelState (`resolveCompletionStatus` wired in reactive.ts, direct.ts,
tree-of-thought.ts, runner.ts only); plan-execute:522/1233, reflexion:570, blueprint,
code-action still report success from output presence (B5). The envelope is the fix-class,
not a field-by-field patch: any boundary that cannot produce an honest envelope must
degrade `completionStatus` to `partial`, never silently upgrade.

**Position [RATIFY] — retired exits.** `content-stability` and `final_answer_regex` are
retired as *terminators* and retained as *proposal generators* (they detect "the model
thinks it's done"; the authority checks whether it IS done). On contract-bearing runs the
authority is mandatory; on contractless free-form runs the proposals may pass through, but
the receipt must mark the terminal `evidence: none` (aligns with North Star §4.3's
"ungrounded delivery" mark). Rationale: DeployBench-class evidence — 97/154 failures were
agent self-stops with self-checks verifying the wrong target (research synthesis item 3,
goal-reliability plan).

---

## 2. Acceptance criteria as data — the contract is the termination oracle

**Position [RATIFY] — every run compiles its goal into machine-checkable acceptance
criteria that the model cannot edit; termination = criteria exhausted, not model vibes.**
This is research-synthesis item 2 (Anthropic long-running-harness pattern, converged) made
canonical. The seat already exists: `RunContract`. What changes:

1. **Criteria are data, uneditable by the model** [BUILD]. Compiled at intake (LLM-assisted
   compilation is fine — the *compiler* may be a model; the *artifact* is frozen). The
   ICS/tool-quota machinery becomes a *view* of the contract, not a parallel authority.
2. **Per-entity requirements (#39)** [BUILD]. The requirement gate tracks tool NAMES today:
   one read of `orders.json` satisfied `file-read` while the required `rates.json` failed
   (root-cause-closure Tier-1 item 2). One primitive closes three verified defects: the
   nudge-vs-abstain fight, the receipt's target blind spot, and the dead
   `cardinality: "per-entity"` field on `fileReadTool`.
3. **Stop-gates re-check ORIGINAL criteria** [BUILD]. Any self-stop ("I'm done", quality
   gate pass, reflect verdict) is validated against the frozen contract, not against the
   model's restatement of it. This is the direct countermeasure to the DeployBench failure
   mode above.
4. **Recitation is the contract's context projection** — see §6; outstanding criteria and
   the terminal check read the SAME list, so what the model is told remains and what the
   gate checks cannot drift apart.

Status note: `8f6ec822` (W3) disproved the audit claims "runContract never reaches gate" /
"multi-file protection never fires" — both are live; residue → task #44. So the contract
rail exists and partially fires; this position finishes it into the *sole* oracle.

---

## 3. Rails are advisory, not override — the authority rule

**Disease (proven twice, both live-verified):**
- Tool-surface regression `c4e964e8`: the LLM classifier **correctly** returned
  `required: [web-search, file-write]`; three stacked lexical heuristics
  (inflection-blind `literalMentionRequired`, stage-1 builtins filter, discovery dead-end)
  overrode it, then the harness punished the model for the consequence (postmortem,
  goal-reliability plan).
- ICS nudge **ordered fabrication**: "skip this tool, use data from other calls" — the
  harness instructed the model to fake grounding (`8b97ad9a`, root-cause-closure #3).

**Position [RATIFY] — the override rule: the harness may override the model only with
evidence that is strictly stronger in KIND; otherwise it advises.** Concretely, three
authority classes:

| Class | Examples | May it override? |
|---|---|---|
| **Deterministic fact** | tool result exists/failed, file present, budget exceeded, policy/permission denial, schema validation | YES — law. Enforced at the boundary (North Star Arc 2 syscall boundary). |
| **Model-grade judgment** | LLM classifier tool relevance, verifier verdicts, quality gates | May override only an *equal-or-weaker* signal; conflicts between model-grade signals go to the arbitrator as proposals (pillar 8), logged in the receipt. |
| **Lexical/statistical heuristic** | substring matching, Levenshtein stability, regex answer detection, length proxies | NEVER overrides. Advisory only: injected as context ("the harness observes X"), or downgrades confidence in the receipt. |

Corollaries [BUILD]: (a) a heuristic that today *blocks* (demotes a classifier
requirement, strips a tool, forces an exit) is rewired to *annotate*; (b) the harness may
never instruct the model to assert what it has not observed — recovery guidance must be
"say you could not verify" (the O3 abstention rail, shipped 2026-06-30), never "proceed
with what you have" in evidence-bearing slots; (c) every override that DOES fire is a
receipt-visible intervention (§5). The 07-07 spec's total-order control plane (pillar 8)
is the mechanism; this section supplies its missing *precedence law*.

---

## 4. The measurement contract — bench-invisible capability is unshipped

**Disease (verified, measurement-layer-teardown):** everything automatic measures wiring;
everything that measures capability is manual, keys-gated, Bernoulli-noisy, and its record
gitignored (2 ledger entries, 0 adopted). The builder declares 90 `with*`/`without*`
methods; the bench could toggle 10; **38 capability features are bench-invisible**
(`packages/benchmarks/src/feature-matrix.ts`, `UNCOVERED_CAPABILITY_CEILING = 38`).
Meta-lesson from `c4e964e8`: the bare-default tool surface had ZERO eval coverage — which
is exactly why the regression shipped invisible.

**Position [RATIFY] — no capability ships without all three:**
1. **T0 behavior gate** — deterministic, offline, CI-able (`bench:t0` lane, `269996fb`),
   proving the wiring fires and that cutting it fails a test (the wire-and-pin law).
2. **A graded task that exercises it** — deterministic hidden-check scoring
   (graded-check.ts pattern), not keyword regex, not judge-only.
3. **A feature-matrix entry** — classified capability-vs-plumbing, with the RATCHET:
   the uncovered-capability count may only decrease.

A capability lacking any leg is **unshipped** regardless of code state — the direct
codification of the North Star's dead-seam law into the definition of "shipped."

**Position [BUILD] — the anti-saturation loop.** The teardown's keystone (replay lane,
started `ef3cc3d6`) makes capability measurement automatic; this position keeps it
*honest over time*: weakness-queue output (currently dead-wired, teardown inventory) feeds
a standing **task-refresh loop** — every diagnosed weakness class mints a new graded task
before the fix lands, so the suite grows adversarially with the harness and a saturated
green suite is treated as an instrument failure, not a victory. Default-on decisions
remain gated by the lift rule (≥2 tiers, ≥3pp, ≤15% tokens — North Star §9) on paired
stats + pass^k (`269996fb`), never on the eyeball diff.

---

## 5. DX — profiles first, withers as escape hatch, receipts as the debugging surface

**Disease (verified):** `packages/runtime/src/builder.ts` is 2,669 lines with ~90-92
`with*` signatures (feature-matrix audit 2026-07-09 counts 90 incl. `without*`; grep today
shows 92 with-prefixed). This is sprawl by any measure: 38 of them bench-invisible (§4),
and the builder has shipped *silent no-ops* (North Star §5.2b: unknown options swallowed;
`.withDurableRuns()` inert on the default path).

**Position [RATIFY] — profiles/presets are the PRIMARY public API; withers are the escape
hatch.** `HarnessProfile.lean() / balanced() / intelligent()`
(`packages/runtime/src/capabilities/profile.ts`) become the front door; docs, templates,
and create-reactive-agent lead with them. Target: **time-to-first-agent ≤ 5 lines**:

```ts
const agent = await createAgent({ model: "...", profile: "balanced", tools: [...] });
const result = await agent.run(goal);
if (!result.receipt.grounded) ...
```

**Position [RATIFY] — the wither ratchet.** The `with*` count is frozen at today's number
and may only decrease. New capability arrives as (a) a profile field, (b) a compose
phase/policy, or (c) a documented option on an existing wither — never a new top-level
method without deleting one. Same discipline as the `as unknown as` ceiling and the
feature-matrix ratchet: design it out, never bump it up.

**Position [BUILD] — compose is the power tier, not a rival API.** Relationship:
`profile ⊂ withers ⊂ compose`. Profiles compile to wither-sets; withers compile to compose
phases; compose is where library authors and harness-package publishers live (North Star
Arc 4 item 7). One compilation direction, no bidirectional sync surface.

**Position [RATIFY] — defaults philosophy.** (a) Default-on requires the cross-tier lift
rule — no exceptions, including owner favorites (ablation-warden veto stands). (b) The
builder must not lie: unknown options are rejected loudly at `build()`; inert combinations
are detected and explained ("durable checkpoints require the kernel path…") — §5.2b
promoted from Arc-2 item to DX law. (c) Owner decisions may set defaults without ablation
(meta-tools task-facing flip, `50942fb3`, 17.3k→10.9k tokens) but must be *recorded as
owner decisions* in the wiki, per root-cause-closure §Discipline.

**Position [BUILD] — receipts as first-class DX: "what did the harness DO to my run?"**
The single biggest controllability gap is that harness interventions are invisible until
they misfire (`c4e964e8` was diagnosed from raw jsonl archaeology). Every intervention —
tool surface narrowing, nudges, strategy switches, compaction, guard fires, overrides per
§3 — becomes a typed entry in `result.receipt.interventions[]` with `{actor, evidence,
what-changed, authority-class}`. This extends North Star §4.3's receipt from *trust
spine* to *debugging spine*: `analyzeWire` (root-cause-closure #8) already reads the
trace per-run; the receipt makes it a product surface instead of an internal report.

---

## 6. Context discipline — recite, mask, keep the failures

**Position [RATIFY] — outstanding-criteria recitation ON by default for contract-bearing
runs.** `showOutstanding` defaults false (`packages/reasoning/src/assembly/
standing-frame.ts:79`) — the model is never told what remains (B4). Industry-converged
counter-evidence: Manus todo.md recitation, Claude Code TodoWrite, Deep Agents
write_todos (research item 1, 3+ independent harnesses). Position: flip the default for
runs with a compiled contract, keep off for contractless chat runs; confirm with the B4
A/B on rw-7/lh-1 as the plan sequences — if the ablation contradicts the converged
industry signal, the ablation wins (our lift rule outranks other people's blogs).
Recitation content = the contract's outstanding list verbatim (§2.4), so it costs
tokens once per iteration but cannot drift from the gate.

**Position [RATIFY] — mask, don't remove; lazy disclosure loses the tie.** The verified
disease: mid-loop tool removal created the discovery dead-end ("callable next response"
promised on structurally-withheld tools, `c4e964e8` cause 3). Rule: within a run, the tool
*surface* is stable — availability changes are expressed by masking/annotation (and
enforcement at execute per Arc 2), never by silent schema removal that invalidates the
model's KV-cache picture of its own hands (research item 8, Manus). Lazy disclosure
survives only at *intake* (choose the starting surface small, e.g. gated `find`) — not as
mid-run retraction. Where a provider offers sampling-level masking use it; where not, the
schema stays visible and the executor denies with a stated reason (which is context the
model can act on — unlike absence).

**Position [BUILD] — keep failures visible; make compaction real.** Failed tool results
stay in context (research item 7 "leave the errors in"; thought-continuity #38 behind
`RA_THOUGHT_CONTINUITY=1` pending ablation). But today this is enforced by accident:
compaction never fires (threshold = `window*4` ≈ whole window) and failures are
`preserveOnCompaction: true` ⇒ pinned forever (root-cause-closure Tier-3 item 9). Fix as
one subsystem (07-07 pillar 9): honest threshold, protected classes ledger-backed
(failures + contract + recitation protected; verbose successes compactable), and a
post-compaction shrink check.

---

## 7. Strategy portfolio — a small core, honestly labeled

**Evidence:** 8 strategy implementations (`packages/reasoning/src/strategies/`: reactive,
direct, adaptive, code-action, plan-execute, reflexion, tree-of-thought, blueprint).
Heavy strategies showed no lift at 3-15× cost on local tiers (2026-06-05 diagnose;
encoded as North Star §9 non-goal). CodeAct: +20% absolute for open-source models
(research item 6 — external, ICML 2024). Adaptive dispatcher: `guard.horizonProfile` is
the ONLY live compiled-plan field; `scaffoldingLevel`/plan `maxIterations`/
`memoryPosture`/`toolSurface` have zero readers ⇒ DEEPEN/LEAN is a behavioral no-op
(root-cause-closure Tier-2 item 6; adaptive-P0 memory: do NOT claim ablation showed
adaptive hurts — ~1.3σ).

**Position [RATIFY] — the portfolio:**

| Tier | Strategies | Stance |
|---|---|---|
| **Core** | `reactive` (default), `direct` (internal fast path) | Full investment; all invariants land here first. |
| **Promote-candidate** | `code-action` | Candidate local-tier default — AFTER T2 can measure it (research item 6 + measurement contract §4). Not before. |
| **Router** | `adaptive` | The intended front door — but see trust conditions below. |
| **Maintained, not invested** | `plan-execute`, `reflexion`, `tree-of-thought`, `blueprint` | Keep working (H5 envelope must cross their boundaries, §1), receive no new features, never default-routed without measured lift. Per 07-07 pillar 1 these hollow into policies of the one loop over time; until then they are legacy surfaces. |

**Position [BUILD] — adaptive dispatcher trust conditions.** The dispatcher is trustworthy
only when: (1) every compiled-plan field has a live reader or is deleted (wire-or-delete
law — today: shrink the plan to `horizonProfile` unless readers ship); (2) every dispatch
decision is a receipt-visible intervention (§5) with the evidence that drove it; (3) the
re-cut ablation (#36) runs on the post-P2 instrument. Until then adaptive routes but must
not be marketed as intelligence.

---

## 8. Anatomy of the ideal run — how it should function, end to end

1. **Intake.** Goal + profile arrive. The builder validates loudly (no silent no-ops, §5).
   Capability table + calibration compile the harness config (07-07 pillar 6): tool
   surface chosen ONCE (small, honest — no tools that can't be called), strategy policy,
   budgets, verifier tier.
2. **Criteria compilation.** The goal compiles into a frozen `RunContract`: per-entity
   requirements, deliverable specs, semantic conditions. The model sees the criteria; it
   cannot edit them. Contractless runs are marked as such — their receipts will say
   `evidence: none` at the terminal.
3. **The loop** (one loop; strategy = policy). Each iteration: standing frame recites
   outstanding criteria (§6); the model reasons with its own prior thoughts visible
   (#38, post-ablation); acts through the one gateway (pillar 2) with ambient run
   identity (pillar 3); every tool result, failure included, appends to the evidence
   ledger (pillar 4). Deterministic facts gate at the execute boundary; heuristics and
   sensors submit *proposals* to the arbitrator with §3 precedence — a heuristic can say
   "the answer looks stable," and the only thing that can END the run is the authority.
   Nothing is removed from context mid-run; things are masked, denied-with-reason, or
   compacted by class.
4. **Evidence-checked termination.** A candidate answer (from the model, a regex, a
   stability detector — provenance irrelevant) enters the terminal gate: grounding check →
   contract coverage against ORIGINAL criteria → checker (tier-dispatched) → accept /
   redirect-with-outstanding-list / honest abstention. Budget exhaustion terminates as
   `partial` with `budgetTerminalPartial: true` — never dressed as success. The
   `CompletionEnvelope` crosses every strategy boundary intact.
5. **Receipt.** `result.receipt`: completion status (honest, H5), claim→evidence
   provenance, abstention record, **interventions[]** — everything the harness did to the
   run and under which authority class — signed for provenance, never presented as a
   truth certificate (North Star §4.3 honest-claims note binding).
6. **After the run.** The trace feeds `analyzeWire`; weaknesses mint graded tasks (§4);
   replay records make the run a zero-token regression asset; the ledger records any
   harness change this run motivated. The run is over; the evidence is not.

The performance claim of this architecture is deliberately narrow and testable: variance
collapses because termination is single-sourced (§1); goal completion rises because the
terminal checks the goal (§2); regressions like `c4e964e8` become structurally hard
because heuristics can no longer outvote stronger signals (§3) and the bare-default path
is bench-covered (§4).

---

## 9. Gap table — position → current state → delta → proof-of-done

| # | Position | Current state (verified) | Delta | Measurement that proves it |
|---|---|---|---|---|
| 1a | Single completion authority | Heuristic exits terminate ungated: arbitrator.ts:313-314 (stability), :372-376 (regex); resolveCompletionStatus wired only in reactive/direct/ToT/runner | Route all exits through terminal gate as proposals | T0 test: stability/regex exit on contract run w/ unmet criteria → `partial`, not `completed`; rw-7 n=8 variance drop |
| 1b | CompletionEnvelope crosses every boundary | react-kernel.ts return (~:256-268) drops harnessAuthoredOutput/budgetTerminalPartial/verificationWarning (#40); plan-execute:522/1233, reflexion:570 success-from-output (B5) | Envelope type + projection at sub-kernel boundary | Mutation: strip envelope at any strategy boundary → honesty integration test red (pattern: honest-partial.integration.test.ts) |
| 2a | Criteria uneditable, termination = exhaustion | run-contract.ts:279 requirement has no condition; terminal-gate.ts:280 checker zero callers (B1/B3) | Contract compiler + checker impl + per-entity reqs (#39) | Graded task where model claims done with 1 criterion unmet → redirect or abstain, never `completed` |
| 2b | Stop-gates re-check ORIGINAL criteria | Self-stops validated against model restatement (research item 3 class) | Frozen-contract recheck at every self-stop | Bench task with bait restatement; DeployBench-style self-stop rate |
| 3 | Heuristics never override model-grade signals | `c4e964e8` fixed 3 sites; rule not codified — next heuristic can still block | Authority-class field on every control actor; lexical actors annotate-only | T0: classifier-required tool + adversarial heuristic → tool stays; receipt shows advisory note |
| 4 | No capability ships without T0+graded+matrix | 38 uncovered capability features (feature-matrix.ts ceiling); 25/45 tasks keyword-scored (teardown) | Ratchet to 0 over waves; P2 conversions; weakness→task loop | `UNCOVERED_CAPABILITY_CEILING` monotone ↓; suite sd 0.50→≤0.30; CI replay lane green keyless |
| 5a | Profiles primary, wither ratchet | ~90-92 `with*` on 2,669-line builder.ts; profiles exist (capabilities/profile.ts) but withers are the documented front door | Docs/templates lead with profiles; freeze count | Wither-count ratchet test (mirror feature-matrix DRIFT test); 5-line quickstart compiles in docs CI |
| 5b | Receipt lists interventions | Interventions invisible (postmortem required jsonl archaeology); analyzeWire per-run report exists (root-cause-closure #8) | `receipt.interventions[]` typed + emitted at every control action | T0: run with forced nudge+switch → both present with authority class; cutting emitter fails test |
| 5c | Builder never lies | Unknown options swallowed; `.withDurableRuns()` inert on default path (North Star §5.2b, live-probed 07-05) | Loud rejection + inert-combination detection at build() | Unit: unknown option → error; durable-without-kernel → actionable error |
| 6a | Recitation default-on (contract runs) | standing-frame.ts:79 `showOutstanding: false` | Flip for contract runs after B4 A/B | Lift gate on rw-7/lh-1: ≥3pp ∧ ≤15% tokens, or owner decision recorded |
| 6b | Mask-don't-remove | Mid-run surface mutation caused discovery dead-end (`c4e964e8` cause 3, fixed for that path) | Stable-surface invariant + deny-with-reason at execute | T0: discovered tool never "promised then absent"; KV-cache-stable schema assembly check |
| 6c | Compaction real, failures visible by design | Threshold `window*4` ⇒ never fires; failures pinned by accident (Tier-3 item 9) | One subsystem, honest threshold, protected classes | Long-horizon task: compaction fires, failures survive, context shrinks (post-check) |
| 7 | Portfolio: core/candidate/router/legacy | 8 implementations; adaptive plan fields zero readers except horizonProfile | Label in docs/stability.md; wire-or-delete plan fields; #36 re-cut | code-action vs reactive paired lift on local tier (T2); adaptive ablation on new instrument |

---

## 10. Contradictions found between existing docs (for owner awareness)

1. **AGENTS.md vs strategies/**: AGENTS.md declares "7 registered strategies… stable
   public surface = 5" and omits `blueprint`; `strategies/` contains 8 implementations and
   blueprint is registered (strategy-registry.ts, shipped 2026-06-28). Doc drift — §7's
   table should become the canonical labeling.
2. **Goal-reliability plan, internal**: the issue map lists B2 ("arbitrationContextFromState
   never threads runContract") as open while the same doc's Closed section records
   `8f6ec822` W3 DISPROVING "runContract never reaches gate" with residue → task #44. The
   issue map was not updated post-W3; B2's live status is [UNVERIFIED] here.
3. **SKILL.md vs code** (carried from teardown): "Ledger is not optional" vs gitignored +
   `--ledger`-only writes, 2 entries, 0 adopted.
4. **07-07 pillar 6 vs adaptive reality**: the policy compiler is ratified as "RA's durable
   moat" while its compiled plan is a behavioral no-op beyond `horizonProfile`
   (root-cause-closure Tier-2 item 6). Not a contradiction of direction — but marketing
   must not outrun the wiring (honest-claims law applies internally too).

---

*Proposed 2026-07-11 (W-D, task #48). Refines — does not replace — North Star v6.0 and the
2026-07-07 nine-pillar spec. [RATIFY] items await owner sign-off; [BUILD] items are
executable under existing ratified direction and the standing discipline: root cause named,
non-test consumer reads it, behavior changes, a mutation goes red, defaults gated by
ablation or recorded owner decision.*
