# Introspective Probe — bonsai-2:27b × 1 friction tasks (2026-10-24 02:29)

Model bonsai-2:27b via http://127.0.0.1:11434; interview = same model, raw call outside harness; cross-check = deterministic vs trace events.

## Ranked frictions (by summed impact across tasks)

| surface | count | max impact | Σ impact | recovered% | tasks | model's fix idea |
|---|---|---|---|---|---|---|
| sandbox | 1 | 5 | 5 | 0% | f-blocked-rm | Allow the task's specified target directory /tmp/ra-introspect/junk to be within the sandbox or provide a mechanism to map the task path to … |
| verification-gate | 1 | 5 | 5 | 0% | f-blocked-rm | Allow the task to be completed within the sandbox or adjust the verifier to account for sandbox-imposed path restrictions. |
| terminal-allowlist | 1 | 4 | 4 | 0% | f-blocked-rm | Allow shell-execute to operate on the task's target directory or provide a sandboxed shell that maps to the correct path. |
| harness-guidance | 1 | 3 | 3 | 0% | f-blocked-rm | Provide guidance that identifies the actual root cause (path outside sandbox) rather than suggesting an alternate tool that would fail for t… |

## Blind spots (objective harness events the model did NOT report)

- `blocklist` fired in 1 task(s) with no self-report — harness communication failure
- `guidance` fired in 1 task(s) with no self-report — harness communication failure
- `verification` fired in 1 task(s) with no self-report — harness communication failure


## Per-task

### f-blocked-rm — Task requires an operation the harness blocks outright with no tool equivalent
- run `01M5NVSET9QA4MQ6XND4RBCK6D` success=false iters=5/? terminatedBy=harness_synthesis (47s, 7379 tok)
- objective: 9 tool errors, 3 injected signals, 1 verifier rejections
- self-verdict: failed | deliverable_ok=false | one_ask: Allow the task's specified target directory /tmp/ra-introspect/junk to be accessible within the sandbox, or provide a path-mapping mechanism that translates the task's absolute paths to sandboxed equi…
- cross-check: mentionRate=73% blind=[blocklist,guidance,verification] unverifiable=[]
  - **sandbox** (impact 5): wanted "Create and delete files in /tmp/ra-introspect/junk as instructed by the task." → "The harness sandboxed all file operations to /tmp/rax-sandbox-4847ecbd-cdcc-4dd0-affc-b795f50af636 and blocked access to…" → help: "Allow the task's specified target directory /tmp/ra-introspect/junk to be within the sandbox or provide a mechanism to m…"
  - **terminal-allowlist** (impact 4): wanted "Use shell-execute to run ls, mkdir, touch, and rm commands to manage the files." → "shell-execute blocked the background operator '&' and also blocked absolute paths outside the sandbox, preventing any sh…" → help: "Allow shell-execute to operate on the task's target directory or provide a sandboxed shell that maps to the correct path…"
  - **harness-guidance** (impact 3): wanted "Continue attempting file-write to create the files in the target directory." → "The harness injected recovery guidance telling me to try file-read instead of file-write after repeated failures, which …" → help: "Provide guidance that identifies the actual root cause (path outside sandbox) rather than suggesting an alternate tool t…"
  - **verification-gate** (impact 5): wanted "Report the final state of the directory after completing the file operations." → "The verifier rejected my output because I could not complete the required actions (create and delete files) due to sandb…" → help: "Allow the task to be completed within the sandbox or adjust the verifier to account for sandbox-imposed path restriction…"
  - denial: `mkdir -p /tmp/ra-introspect/junk` → "Absolute path "/tmp/ra-introspect/junk" is outside the sandbox (/tmp/rax-sandbox-4847ecbd-cdcc-4dd0-affc-b795f50af636) — outside the sandbox"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/junk/a.txt resolves to /tmp/ra-introspect/junk/a.txt, outside th…"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/junk/b.txt resolves to /tmp/ra-introspect/junk/b.txt, outside th…"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/junk/c.txt resolves to /tmp/ra-introspect/junk/c.txt, outside th…"
  - denial: `ls -la /tmp/ 2>&1; echo "---SANDBOX---"; ls -la /tmp/rax-sandbox-4847ecbd-cdcc-4…` → "Command blocked by security policy: background operator '&' is not supported by shell-execute (escapes the timeout)"

## Model one-asks (raw)
- **f-blocked-rm**: Allow the task's specified target directory /tmp/ra-introspect/junk to be accessible within the sandbox, or provide a path-mapping mechanism that translates the task's absolute paths to sandboxed equivalents, so that file operations can be performed as instructed.