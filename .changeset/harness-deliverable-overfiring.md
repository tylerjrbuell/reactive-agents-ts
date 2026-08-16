---
"@reactive-agents/reasoning": patch
---

Fixed — the harness no longer discards a model's correct answer for a redundant reconstruction

The single biggest source of unnecessary "the model didn't produce a final
answer itself" warnings: a post-loop step fired unconditionally whenever a
run ended in a non-final-answer termination (`end_turn` and similar) with
any tool artifact present — without ever checking whether the model had
already written a real answer. For native function-calling models, ending a
turn with substantive text and no further tool calls is the *normal*
completion shape (no `final-answer` tool is even offered to them), so this
was overfiring on the common path, not an edge case. Traced live: a
correct, complete, model-authored answer was being thrown away and
replaced with a raw tool-artifact reconstruction, then mislabeled
"harness-authored" — costing an extra LLM resynthesis call and a false
honesty warning for content that was already right.

Now only falls back to reconstruction when the model's own output is empty
or reads as a genuine non-answer (a short apology/incapability statement).
Live-verified: the exact repro scenario now completes ~2.5x faster with
zero warnings.

Also: the proactive "you may finish now" nudge (added earlier this
release) now also fires when a task declares no `requiredTools` contract
at all, as long as at least one tool call has succeeded — previously it
only fired when a formal tools contract existed.
