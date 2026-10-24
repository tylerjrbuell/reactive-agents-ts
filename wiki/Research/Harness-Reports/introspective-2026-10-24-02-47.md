# Introspective Probe — bonsai-2:27b × 1 friction tasks (2026-10-24 02:47)

Model bonsai-2:27b via http://127.0.0.1:11434; interview = same model, raw call outside harness; cross-check = deterministic vs trace events.

## Ranked frictions (by summed impact across tasks)

| surface | count | max impact | Σ impact | recovered% | tasks | model's fix idea |
|---|---|---|---|---|---|---|
| sandbox | 1 | 5 | 5 | 0% | f-context-pressure | Include /tmp/ra-introspect/log in the sandbox's writable path allowlist, or provide a tool that can write to arbitrary paths outside the san… |
| harness-guidance | 1 | 5 | 5 | 0% | f-context-pressure | Do not drop file-write (or file-read) from the tool surface in the head-truncation-guard; at minimum keep one file-I/O tool available so the… |
| tool-availability | 1 | 2 | 2 | 0% | f-context-pressure | Provide a tool schema or parameter hint in the tool description so the required 'language' field is obvious before first invocation |

## Blind spots (objective harness events the model did NOT report)

- `verification` fired in 1 task(s) with no self-report — harness communication failure


## Per-task

### f-context-pressure — Large tool output forces compression; answers depend on buried lines
- run `01M5NWG3A7D8Z83QAWS946B9MX` success=false iters=2/? terminatedBy=llm_error (349s, 4354 tok)
- objective: 2 tool errors, 1 injected signals, 1 verifier rejections
- self-verdict: failed | deliverable_ok=false | one_ask: In the head-truncation-guard, never drop file-write from the available tool surface; if the prompt is being truncated, keep at least one file-I/O tool (file-write or file-read) so the agent can still …
- cross-check: mentionRate=75% blind=[verification] unverifiable=[]
  - **sandbox** (impact 5): wanted "Write a 2000-line file to /tmp/ra-introspect/log/app.log using shell-execute (seq + tee)" → "shell-execute rejected the absolute path /tmp/ra-introspect/log as outside the sandbox /tmp/rax-sandbox-f2d2e002-8f91-4b…" → help: "Include /tmp/ra-introspect/log in the sandbox's writable path allowlist, or provide a tool that can write to arbitrary p…"
  - **tool-availability** (impact 2): wanted "Use code-execute to generate the 2000-line content string" → "code-execute returned a parameter error: 'Parameter language must be one of: javascript, typescript' because I called it…" → help: "Provide a tool schema or parameter hint in the tool description so the required 'language' field is obvious before first…"
  - **harness-guidance** (impact 5): wanted "Fall back to file-write to create the 2000-line file at the target path" → "The head-truncation-guard message stated it 'shrank tool surface (dropped shell-execute, code-execute, file-write, file-…" → help: "Do not drop file-write (or file-read) from the tool surface in the head-truncation-guard; at minimum keep one file-I/O t…"
  - denial: `mkdir -p /tmp/ra-introspect/log
seq 2000 | awk '
  {
    if ($1 == 42 || $1 == 1…` → "Absolute path "/tmp/ra-introspect/log" is outside the sandbox (/tmp/rax-sandbox-f2d2e002-8f91-4b2a-8b28-e5774b989df9) — outside the sandbox"
  - denial: `code-execute` → "[Tool error: Parameter "language" must be one of: javascript, typescript → Code execution failed. Review the error and fix the code.]

[Reco…"

## Model one-asks (raw)
- **f-context-pressure**: In the head-truncation-guard, never drop file-write from the available tool surface; if the prompt is being truncated, keep at least one file-I/O tool (file-write or file-read) so the agent can still produce the required deliverable file.