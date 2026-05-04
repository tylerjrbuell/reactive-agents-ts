# Spike M3: Verifier + Retry Validation

**Date:** 2026-05-04  
**Status:** RED phase complete (test suite + framework)  
**Previous:** p01b (verification gate), p02 (retry on cogito:8b)  
**Next:** GREEN phase (run against real models)

---

## Hypothesis

The verifier-driven retry mechanism (Sprint 3.5 Stage 2.5) effectively recovers from FM-A1 (agent-took-action failures) when combined with IMPROVED RETRY CONTEXT (simplified prompts + explicit examples + temperature tuning), whereas p02's "direct feedback" alone failed to recover cogito:8b.

**Prior evidence (p02):**
- Cogito:8b + generic retry feedback → 0/5 recovery, 4.2× token cost
- Cogito interprets "attach file" as literal attachment, not tool call
- Retry feedback ("You MUST call the tool") didn't move the model

**M3 improvement hypothesis:**
- Provide explicit tool-call examples: `tool_call[read_csv]{filename: 'data.csv'}`
- Simplified system prompt: reduce cognitive load
- Temperature tuning: 0 → 0.2 to reduce stochasticity
- Expected: ≥50% recovery on FM-A1 failures (vs 0% in p02)

---

## Test Coverage (RED Phase)

### 1. Verifier Accuracy Tests

**FM-A1 (agent-took-action failure):**
- ✅ Detects when agent ships output without calling required tools
- ✅ Distinguishes between "no tools available" (skip check) vs "tools required but not called"
- ✅ Correctly identifies cogito:8b fabrication patterns

**FM-C2 (synthesis-grounding):**
- ✅ Flags compression markers (framework scaffolding echo) as hard failure
- ✅ Respects `enableClaimGrounding` flag (default: disabled for Stage 5 quality fix)
- ✅ Evidence-grounded (dollar amounts) check functional

**Contract verification:**
- ✅ Verifier consumes full VerificationContext (action, content, task, priorSteps, etc.)
- ✅ VerifierRetryPolicy consumes VerifierRetryPolicyContext

### 2. Retry Policy Tests

**Default behavior:**
- ✅ Retries on any rejection while budget allows
- ✅ Stops retrying when budget exhausted (respects `maxRetries`)
- ✅ Allows custom policies to suppress retry per failure mode

**Custom policy examples:**
- ✅ Suppress retry for cogito:8b (model-level limitation)
- ✅ Suppress retry for long-form synthesis (T5 regression class)
- ✅ Override signal text with improved context

### 3. Improved Retry Context

**FM-A1 signal (agent-took-action failure):**
```
⚠️ RETRY: You did not call any tools. You MUST emit a tool call in the next response.
Example: To read a file, respond with: tool_call[read_csv]{filename: 'data.csv'}.
Do not just describe what you would do — actually emit the tool call.
```

**FM-C2 signal (synthesis-ungrounded):**
```
⚠️ RETRY: Your answer doesn't cite data from the tool results.
You MUST reference specific numbers, SKUs, or facts from the tool output.
Example: 'The SKU ELEC-4K-TV-001 sales dropped by $3,825.'
Revise to include 3+ specific references from the data.
```

### 4. Measurement Framework

Tests document the analysis framework (not yet populated with real data):

```typescript
interface M3AnalysisResult {
  verifierPrecisionMet: boolean;      // ≥90%?
  retrySuccessMetPrimary: boolean;    // ≥50%?
  frontierLiftMet: boolean;           // ≥95% baseline correctness?
  rootCauseFindings: string[];        // p02 "kills cogito:14b" explanation
}
```

---

## Success Criteria (Promotion Gate)

| Metric | Target | Status |
|--------|--------|--------|
| Verifier precision on FM-A1 | ≥90% | TBD (spike execution) |
| Retry success rate (improved context) | ≥50% | TBD (spike execution) |
| Frontier model (claude-haiku) baseline | ≥95% | TBD (spike execution) |
| Root cause analysis | Explained | TBD (spike execution) |
| All tests green | 100% | ✅ (1,082 tests pass) |

**Promotion rule:** All criteria met → commit feature; otherwise refactor or kill.

---

## Known Limitations

1. **Tests are synthetic.** Real models may behave differently than test fixtures. Spike execution will validate.

2. **Claim grounding disabled by default.** The `enableClaimGrounding: false` flag (Stage 5 quality fix) means synthesis-grounded check doesn't fail on paraphrased answers. To test grounding rejection, tests either:
   - Enable claim grounding via custom Verifier
   - Detect compression markers (framework scaffolding)
   - Use evidence-grounded (dollar amounts) check instead

3. **p02 finding ("retry kills cogito:14b") not yet explained.** The root cause investigation is documented in the analysis framework but requires spike execution against real cogito:14b runs.

4. **Model-specific policy not yet wired.** The verifier supports custom policies but the default `defaultVerifierRetryPolicy` is universal. Stage 5 quality improvement: add detection for "model not responding to feedback" so policy can auto-suppress retry.

---

## Next Steps (GREEN Phase)

1. **Run against real models:**
   - Cogito:8b (FM-A1 scenario from p01b)
   - Claude-3.5-haiku (frontier baseline)
   - Cogito:14b (investigate p02 "kills" finding)

2. **Measure and populate:**
   ```typescript
   // From spike execution results:
   const findings = {
     verifierPrecision: actual%,      // vs target ≥90%
     retrySuccessRate: actual%,       // vs target ≥50%
     frontierCorrectness: actual%,    // vs target ≥95%
     tokenCostMultiplier: actual×,    // vs p02 baseline 4.2×
     rootCauseExplanation: "...",     // p02 observation analysis
   };
   ```

3. **Commit with findings:**
   - If all criteria met: promote verifier-retry mechanism
   - If retry fails: suppress for cogito tier, enable for frontier
   - If verifier precision low: refactor checks

---

## Files Modified / Created

- **Created:** `packages/reasoning/tests/m3-verifier-retry.test.ts` (20 tests, 600+ LOC)
  - RED phase: unit tests pinning verifier contract
  - Analysis framework: success criteria, metric collection
  - Improved retry context examples
  - Root cause investigation template

- **No changes to:** `packages/reasoning/src/kernel/capabilities/verify/verifier.ts`
  - Verifier behavior is stable; tests validate current implementation
  - GREEN phase will implement improved context as `VerifierRetryPolicy`

---

## References

- **p01b:** Verification gate catches cogito:8b fabrication (5/5 honest-fail)
- **p02:** Retry feedback doesn't help cogito:8b (0/5 recovery, 4.2× token cost)
- **Sprint 3.5 Stage 2.5:** Verifier-driven retry with injection hooks
- **Stage 5 quality fix:** Claim grounding disabled by default (was 64-73% reject rate)
- **North Star v3.0 §3.1:** Verifier as first-class capability

---

## Spike Plan (Rule 6 Format)

**PROMOTION criteria:** All three met
1. Verifier precision ≥90% on FM-A1
2. Retry success ≥50% with improved context
3. Frontier baseline ≥95% correctness

**KILL criteria:** Any of
- Verifier precision <70%
- Retry success <30% (improved context didn't help cogito enough)
- Frontier baseline <80% (mechanism regressed quality)

**REFACTOR criteria:** Partial success
- Promotion + root cause finding requires policy changes
- Example: "suppress retry for cogito, enable for frontier"
