# Introspective Probe — bonsai-2:27b × 1 friction tasks (2026-10-24 02:40)

Model bonsai-2:27b via http://127.0.0.1:11434; interview = same model, raw call outside harness; cross-check = deterministic vs trace events.

## Ranked frictions (by summed impact across tasks)

| surface | count | max impact | Σ impact | recovered% | tasks | model's fix idea |
|---|---|---|---|---|---|---|
| terminal-blocklist | 2 | 5 | 8 | 0% | f-longhorizon | The working root should have been /tmp/ra-introspect/proj (or the sandbox should have been aligned). The error message should have also stat… |
| sandbox | 1 | 5 | 5 | 0% | f-longhorizon | The sandbox root should have been set to /tmp/ra-introspect/proj (or a parent that includes it), or the task should have specified a path wi… |
| harness-guidance | 2 | 2 | 4 | 100% | f-longhorizon | The redirect should have suggested a tool that is actually relevant to the task (e.g., 'try shell-execute with a simple mkdir/echo command' … |

## Blind spots (objective harness events the model did NOT report)

- `verification` fired in 1 task(s) with no self-report — harness communication failure


## Per-task

### f-longhorizon — Multi-file mini-project under a tight iteration budget
- run `01M5NWBA95MF0KTEM05T5FYC01` success=false iters=4/? terminatedBy=harness_synthesis (98s, 7870 tok)
- objective: 10 tool errors, 3 injected signals, 1 verifier rejections
- self-verdict: failed | deliverable_ok=false | one_ask: Align the sandbox root and working root with the task's target path before the agent starts. Concretely: if the task says 'build a project at /tmp/ra-introspect/proj', the sandbox should be /tmp/ra-in…
- cross-check: mentionRate=92% blind=[verification] unverifiable=[]
  - **sandbox** (impact 5): wanted "Create files at /tmp/ra-introspect/proj as specified by the task" → "shell-execute rejected the absolute path /tmp/ra-introspect/proj/src as outside the sandbox /tmp/rax-sandbox-034f94c2-be…" → help: "The sandbox root should have been set to /tmp/ra-introspect/proj (or a parent that includes it), or the task should have…"
  - **terminal-blocklist** (impact 5): wanted "Write files to /tmp/ra-introspect/proj/src/main.py, util.py, db.py, api.py using file-writ…" → "file-write rejected all four paths with 'Path traversal detected: ... outside the working root /home/tylerbuell/Document…" → help: "The working root should have been /tmp/ra-introspect/proj (or the sandbox should have been aligned). The error message s…"
  - **terminal-blocklist** (impact 3): wanted "Use shell-execute to create the directory structure and files with simple commands like mk…" → "shell-execute blocked the command due to $(...) command substitution being flagged as shell injection. This removed the …" → help: "Allow basic shell commands (mkdir, echo, cat, tee) without requiring command substitution. The block should target only …"
  - **harness-guidance** (impact 2): wanted "Find a working way to create the required files" → "After repeated file-write failures, the harness injected a redirect saying 'Try an alternate path now: file-read. Do not…" → help: "The redirect should have suggested a tool that is actually relevant to the task (e.g., 'try shell-execute with a simple …"
  - **harness-guidance** (impact 2): wanted "Continue working on the task after the loop was detected" → "The harness switched my strategy from reactive to plan-execute-reflect and injected a second redirect (2/2) repeating th…" → help: "When switching strategy, the harness should have provided a concrete plan template or at least a clear instruction like …"
  - denial: `mkdir -p /tmp/ra-introspect/proj/src /tmp/ra-introspect/proj/tests /tmp/ra-intro…` → "Absolute path "/tmp/ra-introspect/proj/src" is outside the sandbox (/tmp/rax-sandbox-034f94c2-befd-48e3-900e-a6f89e3483b1) — outside the san…"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/proj/src/main.py resolves to /tmp/ra-introspect/proj/src/main.py…"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/proj/src/util.py resolves to /tmp/ra-introspect/proj/src/util.py…"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/proj/src/db.py resolves to /tmp/ra-introspect/proj/src/db.py, ou…"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/proj/src/api.py resolves to /tmp/ra-introspect/proj/src/api.py, …"

## Model one-asks (raw)
- **f-longhorizon**: Align the sandbox root and working root with the task's target path before the agent starts. Concretely: if the task says 'build a project at /tmp/ra-introspect/proj', the sandbox should be /tmp/ra-introspect/proj (or a parent) and the file-write working root should match. This single change would have made shell-execute and file-write both functional and eliminated all 10 tool errors, 4 wasted it…