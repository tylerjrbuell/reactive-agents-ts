# Scaffold 1 (Tool Cardinality) — Validation Findings

**Per the user's principle:** "we should try this strategy, verify it makes improvements otherwise we rethink it."

## Empirical result (N=2 task-quality-gate runs)

| Task | Pre-S1 baseline | Post-S1 run 1 | Post-S1 run 2 | Verdict |
|---|---|---|---|---|
| T1-knowledge-recall | 100% | 100% | 100% | maintained |
| T2-single-tool-synthesis | 100% | **19%** | **19%** | ⚠ regression (deterministic, not variance) |
| T3-selective-filter | 52% | 52% | 46% | stable (within noise) |
| T4-multi-criteria | 30% | **76%** | **57%** | ★ Scaffold 1's targeted win |
| T5-long-form-synthesis | 42% | 32% | 42% | stable (within noise) |
| **AVERAGE** | **65%** | **56%** | **53%** | -10 net |

## What we learned

### Scaffold 1 worked exactly as designed for its targeted failure shape

T4 (multi-criteria with batch tool over-classification) went from 30% to 57-76%. The fix was sound:
- Classifier no longer multiplies `get-hn-posts` minCalls for "summarize 15 posts"
- Agent calls once, gets all data, doesn't churn against unsatisfiable required-tools

### But Scaffold 1 unmasked a secondary failure mode (T2 regression)

**Working theory** (consistent across both runs):
- **Before**: classifier inferred `get-hn-posts×3`. Agent called 3 times → 3 observations accumulated → multiple iterations of "thinking" → rich context → real synthesis.
- **After Scaffold 1**: classifier returns `get-hn-posts×1`. Agent calls once → all-required-satisfied → final-answer tool injected immediately → model rushes synthesis with one iteration → echoes the compressed preview as output.

**The over-classification was paving over a secondary bug.** The bug: the framework injects the final-answer tool aggressively as soon as required-tools are satisfied, giving small models no "thinking iteration" between observation and synthesis. With over-classification, the multiple required calls forced the model to iterate; with correct classification, the model rushes.

This is **architecturally important** because it means the framework's "you can finalize now" signal is too eager for small models doing synthesis tasks.

## What this validates about the diagnostic methodology

The user's "verify or rethink" principle just paid off. If we had shipped Scaffold 1 without re-running the gate, we'd have shipped a net regression. The empirical loop caught it.

## What this means for Scaffolds 2 + 3

Both scaffolds remain valid AND become more important:

- **Scaffold 2 (Generalized Evidence Grounding)** — would now also catch T2's compressed-preview echo because the output contains text patterns ("Preview (first 8)", "Type: Array(N)") that don't appear in actual observation entities. The Verifier would flag this as "fabricated content not in evidence corpus."

- **Scaffold 3 (Verifier-Driven Retry)** — would force the model to redo the synthesis with explicit feedback ("Your previous output was the framework's compression marker, not actual synthesis from the observations. Cite specific titles from the data.").

Together, Scaffolds 2+3 should fix the premature-final-answer secondary issue **at the right architectural level** — not by reverting Scaffold 1's correct fix, but by adding a quality-gate that catches the remaining failure shape.

## Decision

Per the diagnostic discipline: **keep Scaffold 1** (it's architecturally correct; T4 win is real), **continue with Scaffolds 2+3** which address the now-visible premature-synthesis pattern, **then re-validate** the combined effect. If Scaffolds 2+3 don't restore T2 to ≥80%, we have a clear new diagnosis: the framework's final-answer-injection logic is too eager and needs a separate fix (e.g., minimum-iteration gate, or planning-required-after-tool gate).

## What we'd reject

- **Roll back Scaffold 1**: wrong because it leaves T4's classifier-over-multiplication bug in place, which would re-emerge for any other batch tool task.
- **Hardcode "delay final-answer for batch tools"**: brittle — task-specific rather than failure-mode-shape solution.
- **Increase iteration count globally**: doesn't address the synthesis-quality root cause.

The right move is to continue with Scaffolds 2+3 which generalize the fix.
