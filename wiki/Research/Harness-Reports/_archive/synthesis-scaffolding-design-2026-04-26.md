# Synthesis Scaffolding — Architectural Design (2026-04-26)

**Frame:** the user named the architectural principle exactly:

> "harness job is to help the model/agent succeed where it would otherwise fail. it's controlling the chaos LLMs often exhibit. We need logical systems that solve the root of the problems for all tasks. No brittle solutions, no spot fixes for specific tasks."

T4 and T5 are *symptoms* of two general failure shapes, not unique tasks. The right scaffolds solve the SHAPES.

---

## The two general failure shapes (not "T4" / "T5")

### Failure Shape A: Batch tool over-classification

**Universal pattern:** any tool whose ONE invocation returns multiple results gets classified as needing N invocations.

Examples (real tools that exhibit this shape):
- `get-hn-posts(count: 15)` → 15 posts in one call. Classifier infers 15 calls.
- `db-query("SELECT * FROM users WHERE country='US'")` → many rows in one call. Classifier might infer one call per US user.
- `list-files(directory: "src/")` → many files in one call. Classifier might infer per-file calls.
- `web-search(query, num_results: 10)` → 10 results in one call. Classifier might infer 10 calls.

**Root cause:** the framework has NO STRUCTURAL way to know which tools batch and which don't. The current heuristic (`isPerEntityLookupTool` matches `"get"|"search"|"http"|"fetch"`) is naive — every batch tool that happens to start with "get" gets misclassified.

**Wrong "fix":** add `count`/`limit`/`n` parameter detection to the heuristic. This is a **brittle** lookup table that fails on `page`/`limit`/`take`/`size`/`max_results` and any future name.

### Failure Shape B: Synthesis-without-grounding

**Universal pattern:** any task asking the agent to synthesize specific data from observations can produce fluent prose that doesn't actually cite the observations.

Examples (real tasks that exhibit this shape):
- "Summarize the top 5 stories" → model writes generic prose without naming actual stories
- "List the 3 highest-priced products" → model fabricates plausible products
- "Cite three quotes from the document" → model invents quotes
- "Identify the customer's main complaint" → model paraphrases generically without using actual support-ticket text

**Root cause:** the framework has no mechanism to VERIFY that synthesized claims trace back to the observation corpus. The existing Verifier check (`evidence-grounded`) only matches dollar amounts. The check is correct in shape but narrow in implementation.

**Wrong "fix":** add a "title-grounding" check. **Brittle** — different tasks need different entity types matched. The check needs to generalize.

---

## The four scaffolds (in dependency order)

### Scaffold 1 — Tool Cardinality Declaration

**What:** Tool schemas gain an optional `cardinality` field declaring call-vs-result semantics.

```ts
type ToolCardinality =
  | "single"      // 1 call → 1 logical answer (default; existing behavior)
  | "batch"       // 1 call → N items (batched output; classifier should NOT multiply)
  | "per-entity"  // must be called once per entity in the task
```

**Why this is general:** it's a tool-author declaration, not a framework heuristic. Any tool author can mark their tool's cardinality; the classifier respects it. New tools, custom tools, MCP tools — all get the same treatment.

**How the classifier uses it:**
```ts
const minCalls =
  toolDef.cardinality === "batch"
    ? Math.max(1, llmMinCalls)                        // never multiply batch tools
    : isPerEntityLookupTool(name) && entityCount > 1
      ? Math.max(llmMinCalls, entityCount)            // existing per-entity logic
      : llmMinCalls;
```

**Backward compat:** `cardinality` is optional. When absent, existing heuristics apply. Tool authors opt-in by declaring it. The framework's built-in tools that batch (web-search, http-get, file-read with multiple matches, get-hn-posts) get marked.

**Closes:** Failure Shape A across any tool that declares `"batch"`.

---

### Scaffold 2 — Generalized Evidence Grounding (Verifier check)

**What:** Promote `evidence-grounding.ts` from "dollar amounts only" to "any extractable claim."

The check operates on output-claim shapes:
- **Quoted phrases** — `"..."` and `'...'` segments in the output
- **Capitalized phrases** — sequences of capitalized words ≥ 2 tokens (potential proper nouns / titles)
- **Significant numbers** — integers ≥ 3 digits and decimal values (existing dollar logic generalizes)
- **Identifiers** — alphanumeric tokens of length ≥ 8 with mixed case or digits (likely IDs)

For each extracted claim, check whether a normalized form appears in the observation corpus (already built by `buildEvidenceCorpusFromSteps`). Claims that don't appear in corpus = ungrounded.

**Threshold:** task-shape-aware. The Verifier returns:
```ts
{
  name: "evidence-grounded",
  passed: ungroundedClaims.length / totalClaims < 0.2,  // ≥80% claims grounded
  reason: ungroundedClaims.length > 0
    ? `${ungroundedClaims.length}/${totalClaims} claims not in tool observations: ${ungroundedClaims.slice(0,3).join(", ")}`
    : undefined,
}
```

**Why this is general:** the check is structural, not task-specific. It operates on what the OUTPUT contains and the OBSERVATIONS contain, regardless of domain. Same shape for HN titles, financial values, customer names, file contents.

**Closes:** Failure Shape B's measurement layer. The Verifier now NOTICES when synthesis is ungrounded.

---

### Scaffold 3 — Verifier-Driven Retry (Self-correction loop)

**What:** when the Verifier returns failure on a SOFT check (format / grounding / completeness — checks the model can fix in another pass), the Arbitrator returns `escalate` with a structured feedback payload. The kernel runner consumes the escalation and runs ONE additional reasoning iteration with the feedback injected as guidance.

**Architecture:**
```
think → produce output
verify → checks pass/fail
arbitrator → if soft-check failed AND retryCount < maxRetries:
              return escalate("retry-with-feedback", { feedback: verifier.summary })
            else if all passed:
              return exit-success
            else (hard failure):
              return exit-failure
runner → if escalate("retry-with-feedback"):
          inject feedback into pendingGuidance
          increment retryCount
          loop back to think
        else: apply Verdict
```

**Why this is general:** ANY synthesis task can benefit from one corrective pass. The model that produced ungrounded prose CAN cite observations when explicitly told which titles to include. The model that missed a section CAN add it on retry. **Bounded by maxRetries (default 1)** — we don't loop forever.

**Why it's not brittle:** the feedback is whatever the Verifier emits. The framework doesn't know about specific tasks; it just relays "Verifier said: X". The model decides how to respond.

**Closes:** Failure Shape B's correction layer. Together with Scaffold 2, makes the system SELF-IMPROVING per iteration.

---

### Scaffold 4 — Format Constraint Surfacing (deferred to TaskComprehender)

**What:** task descriptions often contain explicit format constraints (markdown headings, numbered lists, word counts, specific patterns). Surface these as a structured `FormatConstraints` object the curator renders into the system prompt.

**Why deferred:** doing this with regex is brittle (the user's exact concern). The right home is **TaskComprehender** (Sprint 3.5 in original North Star), which uses an LLM call to extract structured task constraints once. Don't spot-fix; do it right when TaskComprehender lands.

**For now:** Scaffolds 1+2+3 should close T4 and T5 enough to validate the architectural direction. Format scaffolding is the next sprint, not this one.

---

## Why these four (and not more, not fewer)

Each scaffold solves ONE general failure shape with ONE typed contract:

| Failure shape | Scaffold | Contract |
|---|---|---|
| Tool batch over-classification | Tool Cardinality | Tool schema declares cardinality |
| Synthesis ungrounded | Generalized Evidence Grounding | Verifier check operates on extractable claims |
| Verifier signals not actionable | Verifier-Driven Retry | Arbitrator escalates with feedback; runner loops once |
| Format constraints invisible to model | (deferred) Format Constraint Surfacing | TaskComprehender extracts structured constraints |

These four together close ALL the failure modes T4 and T5 surface — and any future task that exhibits the same shapes. **No task-specific code anywhere.**

---

## What we DON'T build (the brittle alternatives we're rejecting)

| Tempting spot fix | Why we're rejecting it |
|---|---|
| Detect "summarize 15" → infer batch | Heuristic on task text. Different tasks phrase batching differently. Brittle. |
| Add "title check" to Verifier | Task-specific. Next task uses different entity type. Doesn't scale. |
| Increase maxIterations for "complex" tasks | What's "complex"? Heuristic on task length? Word count? Domain? All brittle. |
| Inject "you must cite specific titles" reminder | Spot fix for T5. Different tasks need different reminders. Doesn't scale. |
| Per-tool special-casing in classifier | Hardcoded list. Doesn't help custom or MCP tools. Doesn't scale. |

Every alternative we considered shares one property: it doesn't generalize beyond the test case. The four scaffolds above all have the property that **they describe a SHAPE of behavior the framework should always exhibit, regardless of what task is being run.**

---

## Implementation sequence (for this session)

### Commit 1: Scaffold 1 — Tool Cardinality Declaration

- Add `cardinality?: "single" | "batch" | "per-entity"` to `ToolDefinition` (type + Schema)
- Update `inferRequiredTools` classifier to respect cardinality
- Mark built-in batch tools (web-search, http-get, file-read with batch results, etc.) with `cardinality: "batch"`
- Add unit tests
- Re-run task-quality-gate; expected T4: 30% → 80%+

### Commit 2: Scaffold 2 — Generalized Evidence Grounding

- Refactor `evidence-grounding.ts` from dollar-amount specific to claim-shape general
- Add extractors for quoted phrases, capitalized phrases, significant numbers, identifiers
- Update Verifier to use generalized check
- Add unit tests + cf-25 gate scenario
- Should produce a useful Verifier signal even though we haven't wired retry yet

### Commit 3: Scaffold 3 — Verifier-Driven Retry

- Arbitrator: extend `escalate` Verdict with structured feedback payload
- Runner: consume escalation, inject feedback into pendingGuidance, run one more iteration, increment retryCount
- Update Arbitrator's resolution to track retryCount across iterations
- Add unit tests + cf-26 gate scenario
- Re-run task-quality-gate; expected T5: 42% → 70%+

### Validation gate (after all 3 commits)

- Average task-quality-gate composite ≥ 80% on gemma4:e4b
- T2 maintained 100%; T1 maintained 100%
- Failure corpus stable or improving
- All gate scenarios green
- 4500+ tests pass

---

## What this delivers structurally

**The harness now has three new general capabilities:**

1. Tools can DECLARE their semantics; the framework respects declarations rather than guessing
2. The Verifier MEASURES synthesis grounding for any task involving data extraction
3. The framework can SELF-CORRECT through bounded retry when the Verifier flags fixable gaps

These are exactly the "control the chaos" patterns the user named. They're not specific to HN, not specific to summarization — they're properties of how a competent harness handles any agent on any task.

**The same gemma4:e4b that scored 35% on the gate becomes the model that scores 80%+** — not because the model got better but because the harness now does its job.

---

## Open questions (to confirm before shipping)

1. **Cardinality field default**: `"single"` (safe, existing behavior) or undefined → existing heuristics? I lean `"single"` as default for new tools, undefined for backward compat.

2. **Retry max default**: 1 retry (one corrective pass) or 2 (allow refinement)? I lean 1 — bounded cost, model's first revision is usually the right one.

3. **Generalized grounding threshold**: 80% claims grounded = pass, 20% ungrounded = fail? Or stricter (95%)? Empirically tunable; start at 80%.

4. **Should retry happen before exit-success or only on borderline cases?** I lean: retry only when Verifier returned soft-fail (composite < 0.7 with at least one fixable check). Don't retry clean exits.

These are tunable based on what the gate shows after Commit 3.
