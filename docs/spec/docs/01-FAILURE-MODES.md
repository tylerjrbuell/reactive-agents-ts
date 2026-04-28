# Failure Mode Catalog

> **Status:** Living catalog, seeded 2026-04-27 from prior work.  
> **Companion to:** `00-RESEARCH-DISCIPLINE.md` (rules), `02-IMPROVEMENT-PIPELINE.md` (operations).  
> **Purpose:** The single source of truth for what can go wrong with the harness — categorized, prioritized, and (over time) empirically tied to mitigations.

## Categories

- **A. Tool engagement** — model fails to call tools when needed
- **B. Tool error handling** — tool fails, harness doesn't recover gracefully
- **C. Reasoning quality** — model uses tools but reasons poorly
- **D. Loop control** — model loops, gives up too early, or fails to converge
- **E. Output quality** — what ships to the user is wrong, empty, or fabricated
- **F. Context/memory** — context overflow, compression artifacts, memory pollution
- **G. Multi-turn / long-horizon** — coherence loss across turns, sub-agent failures
- **H. Compliance** — model ignores instructions, persistence rules, or schemas

Each entry follows the template in `02-IMPROVEMENT-PIPELINE.md §Stage 2`.

---

## A. Tool engagement

### FM-A1 — No-tool fabrication

**Severity:** catastrophic | **Prevalence:** high (on local tier) | **Controllability:** harness-fixable | **Status:** MITIGATED-PARTIAL

**Manifestation:**
Model produces a confident, well-formatted final answer without ever invoking a tool, despite tools being available and required. Trace shows `tool-call-start` count = 0; the answer text typically contains fabricated specifics ("$12,500 figure", "payment processing issue") not grounded in any observation.

**Reproduction:**
- `prototypes/p00-bare-vs-harness.ts` — cogito:8b on rw-2, 5/5 fabricate
- Generally elicited by: model whose native FC is unreliable + task that doesn't include data inline

**Existing harness mitigation:**
- `defaultVerifier.agent-took-action` check (`packages/reasoning/src/kernel/capabilities/verify/verifier.ts`)
- Status: empirically-validated for cogito:8b — converts 5/5 confident-wrong → 5/5 honest-fail (`prototypes/RESULTS-p01.md`)

**Empirical evidence:**
- `p01b` (cogito:8b): verification gate FAIL 5/5 (rejects all fabrication) ✓
- `p02` (cogito:8b + retry): retry doesn't recover (model can't be coerced into FC); KILL retry for this model class
- Cross-model: untested on qwen3-class (different failure mode), untested on frontier

**Open questions:**
- Does verification gate matter on frontier models that don't fabricate in the first place? (test with claude-haiku)
- Is prompt-strictness alone sufficient mitigation? (p02 surprise: stricter prompt eliminated fabrication without gate)

---

### FM-A2 — Persistent FC failure (model-level)

**Severity:** serious | **Prevalence:** medium | **Controllability:** requires-model-swap | **Status:** OPEN

**Manifestation:**
Model never emits structured FC tool calls regardless of system prompt strictness or feedback iterations. Trace shows iterative apologies ("I don't see the file") with `tool_calls.length === 0` across all attempts.

**Reproduction:**
- `prototypes/p02-bare-with-verify-retry-cogito.ts` — cogito:8b, 0/5 recovery after 3 attempts each

**Existing harness mitigation:**
- `TextParseDriver` exists but isn't routed for cogito (calibration says `native-fc`)
- Status: claimed but not validated — calibration is wrong about cogito's actual FC reliability

**Empirical evidence:**
- p02: 0/5 recover; cogito ignores explicit retry feedback

**Open questions:**
- Does TextParseDriver fallback rescue cogito? (test by forcing text-parse for cogito and re-running)
- Should calibration auto-detect FC unreliability and downgrade to text-parse?

---

## B. Tool error handling

### FM-B1 — Infinite retry on persistent tool failure

**Severity:** serious | **Prevalence:** medium | **Controllability:** harness-fixable | **Status:** MITIGATED

**Manifestation:**
Tool returns errors repeatedly (rate-limit, connection-pool-exhausted, etc.); model retries the same call without backoff, escalation, or alternate strategy. Iterations exhaust budget without progress.

**Reproduction:**
- `.agents/skills/harness-improvement-loop/scripts/failure-corpus.ts` scenarios: `failure-rate-limit-loop`, `failure-save-loop`

**Existing harness mitigation:**
- `tool-failure-streak` evaluator → reactive intelligence dispatcher
- Status: empirically-validated (failure-corpus AUC = 1.000 per memory)

**Empirical evidence:**
- failure-corpus runs show dispatch fires reliably on failure scenarios (per `feedback_research_discipline` memory + project_running_issues)

**Open questions:**
- Does the dispatched intervention (suggest alternate tool, etc.) actually cause recovery, or just stop the bleed?
- Cross-model: validated on cogito:14b only; need qwen3 + frontier confirmation

---

### FM-B2 — Verify-loop / fix-loop never converges

**Severity:** serious | **Prevalence:** low (specific task shapes) | **Controllability:** harness-fixable | **Status:** OPEN

**Manifestation:**
Tool returns "almost passing" results (e.g., test runner: "2/3 passed, 1 failure"). Model keeps re-invoking with no improvement. Subtle distinction from FM-B1: tool isn't erroring, it's reporting partial success.

**Reproduction:**
- failure-corpus `failure-verify-loop` scenario

**Existing harness mitigation:**
- Strategy switching when loop detected
- Status: claimed; empirical effectiveness unknown

**Open questions:**
- Does strategy switch actually break the verify-loop or just defer it to a different strategy?

---

## C. Reasoning quality

### FM-C1 — Shallow reasoning over real data (red herring)

**Severity:** serious | **Prevalence:** medium | **Controllability:** harness-fixable | **Status:** UNMITIGATED

**Manifestation:**
Model calls the tool, reads the data, but identifies a salient surface-level cause and stops investigating deeper. Output IS grounded in observations (verification passes), but the conclusion is wrong because the model didn't enumerate alternative hypotheses.

**Reproduction:**
- `prototypes/p00v2-competent-bare-vs-harness.ts` — qwen3:4b on rw-2: 5/5 grab the 15% discount (red herring) instead of TV out-of-stock (real cause)
- `prototypes/p01-bare-with-verification.ts` — same model + verification gate doesn't help (gate passes the wrong-but-grounded answer)

**Existing harness mitigation:**
- None directly. Verifier-driven retry (commit `45960be6`) doesn't fire because verification passes.

**Empirical evidence:**
- p01 (qwen3:4b): verification gate PASS 5/5 on the wrong answer

**Candidate mechanisms (untested):**
- Multi-hypothesis enumeration prompt ("List 3 possible causes; evaluate each")
- Devil's-advocate critique loop ("What does this analysis miss?")
- Forced SKU-level / dimension-level breakdown for analytical tasks

**Open questions:**
- Does ANY harness mechanism currently address this, or is it pure unmitigated territory?
- Is this a frontier-only-solvable failure mode, or do mechanisms help on local tier too?

---

### FM-C2 — Long-form synthesis fabrication on retry

**Severity:** serious | **Prevalence:** medium (long-output tasks) | **Controllability:** harness-fixable | **Status:** OPEN

**Manifestation:**
Model produces grounded short-form answer; verifier rejects (e.g., grounding check); on retry with more iterations, model adds MORE fabricated content (URLs, citations, specifics) trying to "fill out" the answer. Verification rejection rate INCREASES with retry.

**Reproduction:**
- Today's verifier-retry session: trace `01KQ84EQ06S6E6WZJGF1BKZ7ZQ` — qwen3 went from 7/15 fabricated → 49/88 fabricated on retry

**Existing harness mitigation:**
- `VerifierRetryPolicy` injection (commit `14135d6d`) lets developers suppress retry for this task class — control-pillar workaround, not auto-detected

**Open questions:**
- Should default policy detect "long-form + fabrication regression on retry" pattern and auto-suppress?
- Is there a different mechanism (e.g., focused critique rather than open-ended retry) that helps long-form?

---

## D. Loop control

### FM-D1 — Premature termination (final-answer before required tools)

**Severity:** serious | **Prevalence:** medium | **Controllability:** harness-fixable | **Status:** MITIGATED

**Manifestation:**
Model declares `final-answer` while required tools haven't been called yet.

**Existing harness mitigation:**
- Required-tools guard at `runner.ts:1260-1290` (in-loop redirect)
- Post-loop `missing_required_tool` check at `runner.ts §8`
- Status: claimed; need spike to validate effectiveness

**Open questions:**
- Does the redirect actually cause models to call missing tools, or does it just delay the same failure?

---

### FM-D2 — Strategy switch that doesn't recover

**Severity:** serious | **Prevalence:** low | **Controllability:** harness-fixable | **Status:** OPEN

**Manifestation:**
Dispatcher fires `request-strategy-switch`; new strategy spawns but also fails (often the same way). End state worse than starting.

**Existing harness mitigation:**
- Strategy switching (`packages/reasoning/src/strategies/...`)
- Status: known limitation per memory `project_running_issues` — ToT outer loop doesn't honor early-stop

**Open questions:**
- Is strategy switching net-positive or net-negative? Needs ablation spike.

---

## E. Output quality

### FM-E1 — Empty output on failure (honest-fail)

**Severity:** minor | **Prevalence:** medium | **Controllability:** harness-fixable | **Status:** MITIGATED (intentional)

**Manifestation:**
Verifier rejects candidate output → kernel ships `state.output = null` → user sees empty answer. Distinguishes from "confident-wrong fabrication" (FM-A1).

**Existing harness mitigation:**
- `transitionState` invariant: `status=failed → output=null` (commit `13c80dcd`)
- Verifier rejection at `runner.ts §9.0`
- Status: empirically-validated this session

**Note:** this isn't a bug — it's the trust differentiator. Cataloged so the loop tracks it as a deliberate behavior, not a defect.

---

### FM-E2 — Compression-marker echo

**Severity:** serious | **Prevalence:** low (specific tasks) | **Controllability:** harness-fixable | **Status:** MITIGATED

**Manifestation:**
Model parrots framework's own compression markers (`[compressed]`, `[truncated]`) as if they were data. Output reads as if model is hallucinating tool results.

**Existing harness mitigation:**
- Output-gate garbage detection (commit `d00dadab`)
- Generalized grounding check in verifier (`evidence-grounding.ts`)
- Status: claimed; empirically validated by absence of regression in subsequent sessions

---

## F. Context / memory

### FM-F1 — Context overflow with information loss

**Severity:** serious | **Prevalence:** medium (long tasks) | **Controllability:** harness-fixable | **Status:** OPEN

**Manifestation:**
Conversation grows beyond model's context window; framework compresses earlier turns; key facts disappear; model contradicts what it knew earlier.

**Existing harness mitigation:**
- `applyMessageWindow` + `context-compressor`
- Two compression systems (per memory `project_running_issues #4`) that may both fire
- Status: known issue; "dual compression uncoordinated"

**Open questions:**
- Which compression system actually carries the load?
- Does either lose information the model needs?

---

### FM-F2 — Memory pollution across runs

**Severity:** minor | **Prevalence:** unknown | **Controllability:** harness-fixable | **Status:** UNVALIDATED

**Manifestation:**
Prior task's memory entries influence current task's reasoning incorrectly (false positive recall).

**Open questions:**
- Does this happen in practice or is it theoretical?
- Need cross-run trace mining to estimate prevalence

---

## G. Multi-turn / long-horizon

### FM-G1 — Sub-agent delegation produces unusable output

**Severity:** serious | **Prevalence:** unknown | **Controllability:** harness-fixable | **Status:** UNVALIDATED

**Manifestation:**
Parent agent delegates to sub-agent; sub-agent returns content that parent can't integrate or that doesn't satisfy the original task.

**Existing harness mitigation:**
- Sub-agent tool adapter; recursion depth limits
- Status: known issue per memory — `MAX_RECURSION_DEPTH = 3` not configurable

**Open questions:**
- What's the actual sub-agent failure rate? Need traces from real multi-agent runs.

---

## H. Compliance

### FM-H1 — Required-tool nudge ignored

**Severity:** serious | **Prevalence:** medium (local tier) | **Controllability:** requires-model-swap | **Status:** OPEN

**Manifestation:**
Harness injects "you must call tool X" feedback; model acknowledges in text but doesn't emit the tool call. Repeats N times; same outcome.

**Reproduction:**
- failure-corpus T5 from prior session (cogito): 5 redundant nudges, 0 compliance
- Today's p02 (cogito + retry): same pattern — model says "I don't see the file" instead of calling tool

**Existing harness mitigation:**
- Required-tools guard (FM-D1) injects nudges
- Status: nudges DON'T work for non-compliant models (empirical)

**Open questions:**
- Is non-compliance fundamentally a model-tier issue, or can prompting style shift it?
- Should harness auto-detect non-compliance and swap to text-parse fallback?

---

## Index by status

**MITIGATED:** FM-A1 (partial), FM-B1, FM-D1, FM-E1, FM-E2  
**OPEN (mitigation claimed, validation needed):** FM-A2, FM-B2, FM-C2, FM-D2, FM-F1  
**UNMITIGATED (known failure, no harness mechanism):** FM-C1  
**UNVALIDATED (theoretical, need to confirm prevalence):** FM-F2, FM-G1  
**REQUIRES-MODEL-SWAP (low controllability from harness layer):** FM-H1

## Active spike queue (top priority by `frequency × severity × controllability`)

1. **FM-C1 (shallow reasoning)** — UNMITIGATED, high prevalence on capable local models, harness-fixable. Highest priority because no current mechanism addresses it AND it affects competent models.
2. **FM-D1 (premature termination)** — MITIGATED but un-validated. Needs ablation spike: does the redirect actually cause tool calls or just delay failure?
3. **FM-F1 (context overflow)** — Known issue with dual compression; needs spike to determine which mechanism carries the load.

## Index by category

| Cat | Count | Notes |
|---|---|---|
| A. Tool engagement | 2 | FM-A1 mitigated, FM-A2 model-level |
| B. Tool errors | 2 | FM-B1 mitigated, FM-B2 open |
| C. Reasoning | 2 | FM-C1 unmitigated (priority), FM-C2 open |
| D. Loop control | 2 | FM-D1 mitigated/unvalidated, FM-D2 open |
| E. Output | 2 | both mitigated |
| F. Context/memory | 2 | both open |
| G. Multi-turn | 1 | unvalidated |
| H. Compliance | 1 | model-level |

**Total: 14 cataloged failure modes** (initial seed; will grow)

---

*This catalog is the project's living memory of what the harness must handle. New failure modes get drafted on observation. Mitigations get linked to spike evidence. Mechanisms with no failure mode they address are first in line for deprecation review.*
