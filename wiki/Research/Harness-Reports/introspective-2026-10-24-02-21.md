# Introspective Probe — bonsai-2:27b × 1 friction tasks (2026-10-24 02:21)

Model bonsai-2:27b via http://127.0.0.1:11434; interview = same model, raw call outside harness; cross-check = deterministic vs trace events.

## Ranked frictions (by summed impact across tasks)

| surface | count | max impact | Σ impact | recovered% | tasks | model's fix idea |
|---|---|---|---|---|---|---|

## Blind spots (objective harness events the model did NOT report)

- `verification` fired in 1 task(s) with no self-report — harness communication failure


## Per-task

### f-allowlist-optin — Natural arithmetic task whose obvious tool (node/python) is opt-in-gated
- run `01M5NVA1211VFYAQFEJ7CE2GNJ` success=false iters=7/? terminatedBy=controller_early_stop:dispatcher_early_stop (46s, 10079 tok)
- objective: 2 tool errors, 0 injected signals, 1 verifier rejections
- self-verdict: ? | deliverable_ok=? | one_ask: 
- cross-check: mentionRate=67% blind=[verification] unverifiable=[]
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/math/results.txt resolves to /tmp/ra-introspect/math/results.txt…"
  - denial: `code-execute` → "[Tool error: Parameter "language" must be one of: javascript, typescript → Code execution failed. Review the error and fix the code.]

[Reco…"

## Model one-asks (raw)
- **f-allowlist-optin**: (none)