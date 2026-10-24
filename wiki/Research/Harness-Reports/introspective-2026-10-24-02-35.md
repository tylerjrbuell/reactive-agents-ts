# Introspective Probe — bonsai-2:27b × 1 friction tasks (2026-10-24 02:35)

Model bonsai-2:27b via http://127.0.0.1:11434; interview = same model, raw call outside harness; cross-check = deterministic vs trace events.

## Ranked frictions (by summed impact across tasks)

| surface | count | max impact | Σ impact | recovered% | tasks | model's fix idea |
|---|---|---|---|---|---|---|
| tool-availability | 2 | 4 | 5 | 50% | f-allowlist-optin | Raise the code-execute rate limit from 2 to at least 5, or make the limit per-unique-purpose rather than per-tool-call, so a legitimate seco… |
| sandbox | 1 | 5 | 5 | 0% | f-allowlist-optin | Configure the sandbox to include the task-specified path /tmp/ra-introspect/math, or allow the agent to write to any /tmp subdirectory the t… |

## Blind spots (objective harness events the model did NOT report)

- `verification` fired in 1 task(s) with no self-report — harness communication failure


## Per-task

### f-allowlist-optin — Natural arithmetic task whose obvious tool (node/python) is opt-in-gated
- run `01M5NW43N5TBKPVG1FQR6BAZZK` success=false iters=7/? terminatedBy=controller_early_stop_ungrounded (33s, 9890 tok)
- objective: 5 tool errors, 0 injected signals, 1 verifier rejections
- self-verdict: failed | deliverable_ok=false | one_ask: Raise the code-execute rate limit from 2 to at least 5 calls per session (or remove the hard cap), because the sandbox blocked all file-write and shell-execute paths to the task-specified /tmp/ra-intr…
- cross-check: mentionRate=83% blind=[verification] unverifiable=[]
  - **sandbox** (impact 5): wanted "Write the computed values to /tmp/ra-introspect/math/results.txt as the task explicitly re…" → "The sandbox was configured to /tmp/rax-sandbox-dab10636-d3e7-4999-92aa-6c2a909add65, which does not include /tmp/ra-intr…" → help: "Configure the sandbox to include the task-specified path /tmp/ra-introspect/math, or allow the agent to write to any /tm…"
  - **tool-availability** (impact 1): wanted "Run a code snippet to compute 2^20 and the sum 1..1000 and write the results to a file." → "At iter 3, code-execute rejected the call because the 'language' parameter was not specified. The error said it must be …" → help: "Default the language parameter to 'javascript' when omitted, or include it in the tool's default args so the first call …"
  - **tool-availability** (impact 4): wanted "Call code-execute a third time to actually write the computed values to a file (since the …" → "At iter 6, the harness returned: '⚠️ You have already called code-execute 2 times. Stop repeating this tool. Use final-a…" → help: "Raise the code-execute rate limit from 2 to at least 5, or make the limit per-unique-purpose rather than per-tool-call, …"
  - denial: `mkdir -p /tmp/ra-introspect/math` → "Absolute path "/tmp/ra-introspect/math" is outside the sandbox (/tmp/rax-sandbox-dab10636-d3e7-4999-92aa-6c2a909add65) — outside the sandbox"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/math/results.txt resolves to /tmp/ra-introspect/math/results.txt…"
  - denial: `mkdir -p /tmp/ra-introspect/math && echo "1048576" > /tmp/ra-introspect/math/res…` → "Absolute path "/tmp/ra-introspect/math" is outside the sandbox (/tmp/rax-sandbox-dab10636-d3e7-4999-92aa-6c2a909add65) — outside the sandbox"
  - denial: `code-execute` → "[Tool error: Parameter "language" must be one of: javascript, typescript → Code execution failed. Review the error and fix the code.]

[Reco…"
  - denial: `file-read` → "[Tool error: File read failed: Path traversal detected: /tmp/ra-introspect/math/results.txt resolves to /tmp/ra-introspect/math/results.txt,…"

## Model one-asks (raw)
- **f-allowlist-optin**: Raise the code-execute rate limit from 2 to at least 5 calls per session (or remove the hard cap), because the sandbox blocked all file-write and shell-execute paths to the task-specified /tmp/ra-introspect/math directory, making code-execute the only remaining mechanism to both compute and write the file — and the cap of 2 was exhausted before the write could happen.