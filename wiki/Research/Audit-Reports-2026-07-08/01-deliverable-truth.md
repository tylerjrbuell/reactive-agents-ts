# Deliverable-Truth Audit 2026-07-08 — 01-deliverable-truth

**Mission:** how does the harness know WHAT HAS BEEN DELIVERED vs what remains? Feeds Phase 4 (Evidence Ledger) of the ratified adaptive-harness overhaul ([[../../Planning/Implementation-Plans/2026-07-07-adaptive-harness-overhaul]] §Phase 4). Builds on, does not re-derive, [[../Audit-Reports-2026-07-07/00-SYNTHESIS-architecture-efficiency-sweep]] (Diseases 1-3, ledger shape `{full, preview, extractedFact, storedKey}` confirmed there).

Advisor unavailable this session. All claims below verified by direct read; file paths relative to repo root, all in `packages/reasoning/src` unless noted.

**Verdict in one line:** the harness has a *success authority* (post-conditions) and an *output assembler* (deliverable.ts) but **no deliverable record** — artifacts, claims, and requirement verdicts are either never persisted or recomputed-and-discarded, so "what has been delivered vs what remains" is answerable only for the narrow single-file + required-tools shape, and only by re-scanning steps[] with a 4-name tool vocabulary.

---

## Q1 — Can the harness, mid-run, enumerate {artifacts, claims, requirements satisfied, requirements outstanding}?

| Set | Where it lives today | Enumerable? |
|---|---|---|
| **Artifacts produced** | Latent only: action steps carry `metadata.toolCall.arguments` incl. the path (act.ts:363; step.ts:47-51); success linkage via `toolCallId` → `observationResult.success` (post-conditions.ts:233-254) | **NO API.** `isArtifactProduced` (post-conditions.ts:203-257) is *target-driven* — "was path P produced?" — never "list all paths produced". No inverse/enumerating function exists anywhere. |
| **Claims made** | **NONE.** `extractMeasurementClaims` (verify/evidence-grounding.ts:186-199) extracts numeric claims transiently at the synthesis gate (:222-226) and discards them | NO — nothing persisted, no claim→evidence linkage recorded |
| **Requirements satisfied** | Recomputable: `verify(state.meta.postConditions, state.steps)` is pure (post-conditions.ts:268-298); tool-level via `buildSuccessfulToolCallCounts` (verify/requirement-state.ts:30-58) | Computable but **never recorded** — `result.met` is dropped at both gate sites (arbitrator.ts:879-882, terminate.ts:132-135) |
| **Requirements outstanding** | Same recompute; `getEffectiveMissingRequiredTools` (requirement-state.ts:136-144) for the tool floor | Computable; surfaced only as *prose* — `describeUnmet` steering text (post-conditions.ts:301-322) or the terminal `error` string (terminate.ts:142-144). Structured breakdown lost. |

**Finding 1 (HIGH — Phase 4).** No enumerable artifact record. The path IS in the ledger (action step `toolCall.arguments`), but recognition depends on a 4-name write-tool vocabulary `WRITING_TOOL_NAMES` = {file-write, write-file, fs-write, writefile} (post-conditions.ts:139-144) and a 15-key path-arg whitelist `PATH_ARG_KEYS` (post-conditions.ts:159-175). Writes performed via `code-execute`/shell, MCP tools, or any exotic arg key are **invisible to deliverable truth** (acknowledged in-file as the acceptable false-UNMET direction, :156-158 — acceptable for a gate, fatal for an inventory). No content hash, no byte size, no create/update distinction is recorded anywhere.

**Finding 2 (HIGH — Phase 4).** Claims: NONE persisted. The only claim machinery is the numeric-claim spot-check inside the synthesis grounding gate; its extraction result never touches state, steps, receipt, or trace. Post-run honesty labeling (sweep report 06) grades the run without ever seeing which claims were checked against which evidence.

**Finding 3 (MED-HIGH — Phase 4).** Requirement verdicts are recomputed at ≥3 sites and thrown away each time: mid-loop steer gate (arbitrator.ts:867-891), terminal hard-stop (terminate.ts:107-153), plus per-iteration required-tool scans (requirement-state.ts callers in think/loop). `PostConditionResult.met/unmet` is a perfectly good verdict record — it just has nowhere to go.

---

## Q2 — Deliverable provenance: produced where, consumed where, dropped where

**The type is good; the pipeline destroys it.** `Deliverable` is a 4-source discriminated union with structural anti-leak invariants (`ValidatedObservation._validated`, packages/core/src/contracts/deliverable.ts:59-127).

Producers:
- `assembleDeliverable` (kernel/loop/runner-helpers/deliverable.ts:78-107): priority contract — trailing thought ≥100 chars (`MIN_MODEL_SYNTHESIS_LENGTH`, :40) → `model_synthesis`; exactly 1 validated observation → `tool_artifact`; >1 → `harness_synthesis` (raw concatenation, no LLM); else `sentinel`. Call sites: runner.ts:839 (§8.5 post-loop promotion), :875 (§8.7 lastThought fallback via `modelSynthesisDeliverable`), :896 (§8.8 empty-output invariant); stall-deliverable.ts:176, :283.
- `passthroughOutputDeliverable` (deliverable.ts:134-140) — **provenance laundering by design**: wraps ANY prior `state.output` string as `model_synthesis` for low_delta/switching_exhausted/stop-checkpoint paths (iterate-pass.ts:501, :648; runner.ts:425). The doc comment explains why (truthiness gates at runner.ts:535/591/680), but the effect is that a harness-concatenated artifact re-enters the system stamped "model authored".

Consumers — and where provenance dies:
1. `deliverableTerminationReason` (deliverable.ts:202-210) collapses 4 sources → 2 `terminatedBy` values (`harness_synthesis` = "already final, don't re-synthesize"; `harness_deliverable` = "attempt synthesis"), with a documented naming collision (:195-200). Sole purpose: gate the §9 re-synthesis pass.
2. `commitDeliverable` (deliverable.ts:162-171) writes `output = deliverableToContent(d)` — **the typed object is dropped at this line**. Not stored on `KernelState` (kernel-state.ts:396 `output: string | null`), not on `AgentResult` (runtime/src/builder/types.ts:857-937 — `output: string` + `terminatedBy` only), not on `TrustReceipt`, not on trace. Its own JSDoc records that a typed `meta.deliverableSource` was deliberately deferred (:148-152).
3. `terminate()` (kernel/loop/terminate.ts:166-184) same collapse for every imperative path.

**Finding 4 (HIGH — Phase 4).** Post-run, "was this answer model-authored, a single tool artifact, or harness-concatenated?" is unanswerable except through the lossy 2-value `terminatedBy` encoding — and `passthroughOutputDeliverable` falsifies even that at the passthrough sites. The receipt's honesty story (Phase 4 amendment: "honesty label merges into receipt") cannot be built until the Deliverable value survives commit. Note `commitDeliverable` is *documented* as not-yet-kernel-wide single writer (deliverable.ts:157-160).

---

## Q3 — Post-conditions: full inventory + deliverable-blind goal shapes

Inventory — **exactly 3 kinds** (post-conditions.ts:53-56):
1. `ToolCalled{tool}` — judged from successful observations incl. delegated credit (requirement-state.ts:30-58).
2. `ArtifactProduced{path}` — toolCallId-linked successful write with matching path-arg, suffix-match on "/" boundary (post-conditions.ts:114-119, 203-257). Ledger-only, no fs.
3. `OutputContains{pattern}` — substring on assembled output. **Never derived** — reserved (derive-conditions.ts:12-15), only re-exported for manual callers (:192-194). Grep shows no production caller constructs it.

Derivation (`deriveConditions`, derive-conditions.ts:164-190): `requiredTools → ToolCalled(each)`; plus **at most ONE** `ArtifactProduced` from `deriveDeliverablePath` (:97-156). Seeded once at kernel-start (runner.ts:319-327 → `state.meta.postConditions`, kernel-state.ts:350-368).

Brittleness of the single derivation regex chain:
- `WRITE_VERB = /\b(write|create|save|generate|produce|output)\b/gi` (:47) — inflected forms miss: "creates", "generated", "writing", "saving" derive nothing.
- Path must be a literal token with a known extension or explicit separator (:46, 55-84, 139-142); "save a report in the reports folder", "write it to disk", extensionless paths → nothing.
- Only the path following the LAST write verb is taken (:103-116) — all earlier deliverables discarded.

**Finding 5 (HIGH — Phase 4, feeds Phase 6).** Deliverable-blind goal shapes (derive → EMPTY set, success authority = prose verdict only):
- **Research/report tasks with no literal filename** — the rw-1 class; nothing derivable.
- **"Answer + save it"** where the save target is described, not named.
- **Multi-file outputs** — only 1 of N files ever conditioned (see Q4).
- **Directory/tree outputs**, **quantity requirements** ("3 files"), **content-quality requirements** (OutputContains never derived).
- **Writes via non-canonical tools** (bash, code-execute, MCP writers) — even a derived condition can't be satisfied, false-UNMET forever.

---

## Q4 — The multi-deliverable gap (rw-8 witness)

rw-8 (packages/benchmarks/src/tasks/real-world.ts:726-780): 5 phases, wants `types.ts` + `generate.ts` + `validate.ts` + run + report. Tracing `deriveConditions` over its prompt:
- `WRITE_VERB` last match = "Write" in "Phase 4: Write a validator (validate.ts)…" ("creates"/"generated"/"report results" don't match the verb regex).
- Paren-preferred path capture → `validate.ts`.
- Result: **{ArtifactProduced(./validate.ts), ToolCalled(file-write)}** — `types.ts` and `generate.ts` are invisible to the state-grounded success authority; Phase 5 (run + report) has no condition at all. A run that writes only `validate.ts` and stalls passes both post-condition gates.

Mechanism for partial completion: **NONE.**
- `requiredToolQuantities` (requirement-state.ts:64-73) is the only counting primitive — call-count floors ("file-write ≥ 3"), not distinct-path tracking, and `deriveConditions` never seeds quantities.
- plan-execute's plan steps are a separate record (types/plan.ts) never projected into post-conditions; a plan step "write generate.ts" completing or not is invisible to the gates.
- The in-loop "artifact" counter `countDeliverableCandidates` (deliverable.ts:242-249; iterate-pass.ts:643, :851-854, runner.ts:666/703) counts **deliverable-ELIGIBLE observations** (any successful non-meta tool result), not deliverables — a semantic conflation: 5 successful web-searches = "5 artifacts" for stall/abstention logic.
- Partial credit exists only OFFLINE, in the bench judge's LLM rubrics (real-world.ts:763-777) — the harness itself has no notion of 2-of-3-done.

**Finding 6 (HIGH — Phase 4).** Multi-deliverable tasks have no in-harness completion fraction, no per-deliverable verdicts, and no steering signal naming the *remaining* files. The single-path derivation makes the gate actively misleading on exactly the task class (rw-8) where memory-under-pressure needs a requirement anchor.

---

## Findings 7-10 — supporting surfaces

**Finding 7 (MED — Phase 4, "honesty live" merge).** `TrustReceipt` reads only: `toolCalls{name, ok}`, `terminatedBy`, `verifierVerdict`, `goalAchieved`, `abstained`, `success` (packages/core/src/types/receipt.ts:73-103; derivation runtime/src/builder/helpers.ts:137-190 pairs action↔observation by toolCallId; assembly at runtime reactive-agent.ts:1500 and engine/execute-stream.ts:411). It never sees artifacts, post-condition met/unmet, deliverable source, or claims. "tool-grounded" therefore means "some tool succeeded", not "the deliverable exists". The terminal gate's demotion does flow in indirectly (unmet → `status:"failed"` → `success=false` → verdict "failed"), but WHICH condition failed survives only inside the `error` prose (terminate.ts:142-144).

**Finding 8 (MED — Phase 3/4 seam).** The new terminal gate (kernel/capabilities/decide/terminal-gate.ts) deliberately owns answer LEGITIMACY and excludes the deliverable-existence authority (:14-16 "PostCondition steer … NOT folded in here"). Its input (:66-113) carries requiredTools/coveredTools/grounding — no artifacts, no conditions. Meanwhile deliverable existence remains split across two gates with divergent remedies: steer-and-continue (arbitrator.ts:886-891) vs hard-fail (terminate.ts:140-152) — sweep Disease 1, unresolved. Phase 4's ledger is the precondition for folding existence into the gate: `(candidate, ledger, contract)` per the plan's Phase 3 signature only works when the ledger can answer "artifacts so far".

**Finding 9 (MED — Phase 4, confirms sweep shape).** Evidence stores today: scratchpad `_tool_result_N` holds full content (act/tool-execution.ts:534-536, :553-554, :713-715); observation steps hold preview + `storedKey` + `extractedFact` (types/step.ts:52-57; tool-execution.ts:694-704); `fullContent` returned but consumed only by plan-execute synthesis (:702-704); memory now fed full content (hotfix 0.5-4, :607-619). Nothing links scratchpad keys back to deliverable identity — you cannot ask the scratchpad "which of these are artifacts". Confirms the sweep's ledger entry shape `{full, preview, extractedFact, storedKey}` and adds: the entry needs an *artifact facet*, not just a content facet.

**Finding 10 (LOW-MED — Phase 4 hygiene).** Output assembly still has 3 overlapping post-loop fallback blocks (§8.5 runner.ts:831-847 narrow-whitelist promotion; §8.7 :869-877 lastThought; §8.8 :890-897 general) each independently calling `assembleDeliverable`/`commitDeliverable` — same content can acquire different provenance depending on which block fires (sweep Disease 1 "3 overlapping fallback blocks", confirmed from the provenance angle).

---

## Q5 — Proposed RunLedger entry types for deliverable truth (Phase 4 schema)

Consistent with the plan's sketch (tool-invocation(+result), claim, verdict, harness-signal, compaction-marker, checkpoint-marker; steps become a projection) and the sweep's `{full, preview, extractedFact, storedKey}` content shape. Additions for deliverable truth are **artifact**, **requirement**, and **deliverable-commit**:

```ts
type LedgerEntry = { id: EntryId; runId: string; iteration: number; at: number } & (
  | { kind: "tool-invocation"; callId: string; tool: string;
      args: Record<string, unknown>; argsDigest: string }
  | { kind: "tool-result"; callId: string; ok: boolean;
      content: { full: ContentRef /* scratchpad/ResultStore key */;
                 preview: string; extractedFact?: string } }
  // NEW — emitted by the act capability whenever a successful call's tool is
  // artifact-producing (registry-declared `produces: "file" | ...`, replacing
  // the WRITING_TOOL_NAMES/PATH_ARG_KEYS guess with tool self-declaration;
  // heuristic fallback for undeclared tools):
  | { kind: "artifact"; callId: string; path: string; op: "create" | "update" | "delete";
      producedBy: string /* tool */; contentDigest?: string; bytes?: number }
  // NEW — requirements become first-class entries at run-start (derived),
  // via .with* declaration, or appended mid-run (plan steps project in):
  | { kind: "requirement"; reqId: string; origin: "derived" | "declared" | "plan";
      spec: PostCondition /* existing 3 kinds + ArtifactProduced[] set form */ }
  // Verdicts persist what verify() computes today and then discards:
  | { kind: "verdict"; subject: { reqId: string } | { claimId: string } | "terminal";
      status: "met" | "unmet" | "unverifiable";
      by: "post-conditions" | "verifier" | "terminal-gate" | "checker" }
  | { kind: "claim"; claimId: string; source: "model" | "harness"; text: string;
      groundedBy: readonly string[] /* callIds; empty = ungrounded */ }
  // Deliverable provenance survives commit (Finding 4):
  | { kind: "deliverable-commit"; source: Deliverable["source"];
      contentRef: ContentRef; terminatedBy: string;
      assembledFrom?: readonly string[] /* callIds/entryIds */ }
  | { kind: "harness-signal"; signal: string; payload?: unknown }
  | { kind: "compaction-marker"; survivedClasses: readonly string[] }
  | { kind: "checkpoint-marker"; checkpointId: string }
)
```

Queries this makes O(scan) instead of impossible:
- `artifacts(ledger)` → filter `kind:"artifact"` (Finding 1 closed).
- `outstanding(ledger)` → requirements minus latest met verdicts (Findings 3, 6 closed; steering can name the remaining 2 of 3 files).
- `receipt(ledger)` → verdicts + artifacts + deliverable-commit (Finding 7: receipt gains `artifactsProduced`, `requirements: {met, unmet}`, `deliverableSource` with zero new instrumentation).
- `claims(ledger)` → live honesty labeling (Finding 2).
- Terminal gate signature `(candidate, ledger, contract)` becomes literal (Finding 8).

---

## Phase 4 requirements extracted

1. **Artifact entries are first-class**, emitted at act-time; tool registry declares `produces` so recognition stops depending on the 4-name `WRITING_TOOL_NAMES` / 15-key `PATH_ARG_KEYS` guess (keep the heuristic as fallback for undeclared/MCP tools). Record path + op + optional contentDigest.
2. **Requirement entries + verdict entries**: persist `PostConditionResult.met/unmet` every time a gate runs, instead of recomputing-and-discarding; `describeUnmet` becomes a projection of unmet verdicts.
3. **Multi-artifact conditions**: `deriveConditions` must emit an `ArtifactProduced` per path (drop the last-write-verb single-path rule) and Phase 6's policy compiler should let task classification/plan steps append requirement entries mid-run (plan-execute step "write generate.ts" → requirement entry, closing the rw-8 gap).
4. **Deliverable provenance survives commit**: `deliverable-commit` entry (or typed `meta.deliverableSource`, already anticipated at deliverable.ts:148-152); retire `passthroughOutputDeliverable`'s model_synthesis laundering by giving passthrough its own source tag once the truthiness gates read the ledger instead of string falsiness.
5. **Receipt reads the ledger**: add artifacts/requirements/deliverableSource to `TrustReceipt` (mirror `TrustReceiptWire` per receipt.ts:12-15), making "tool-grounded but deliverable-missing" expressible — today it is not.
6. **Claim entries** at synthesis-gate time (the extractor already exists, evidence-grounding.ts:186-199) with `groundedBy` callId links — the honesty-label merge (sweep amendment, Phase 4 row) needs this to be live rather than offline.
7. **Rename/repair the "artifact" counters**: `countDeliverableCandidates` and `prevArtifactCount`/`artifactsAvailable` (iterate-pass.ts:643, 851) must either read real artifact entries or be renamed evidence-counters — abstention's `hasDeliverable` currently treats any successful tool call as a deliverable.
8. **Terminal gate consumes the ledger**: fold deliverable-existence (both post-condition gates) into `terminal-gate.ts` per the Phase 3 signature, unifying steer-vs-hard-fail behind one policy — unblocked by items 1-2.
9. **Content digest on artifact + tool-result entries** (cheap SHA-256 of full content) so replay/resume equivalence tests (plan §Phase 4 Verify) can assert artifact identity, and duplicate-write detection becomes possible.
10. **steps[] as projection must preserve** `toolCall.arguments` path recovery for legacy consumers until all gates read artifact entries (migration order: emit dual, flip readers, delete scan).
