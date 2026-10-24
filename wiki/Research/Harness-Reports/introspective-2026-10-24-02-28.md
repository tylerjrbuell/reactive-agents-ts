# Introspective Probe — bonsai-2:27b × 1 friction tasks (2026-10-24 02:28)

Model bonsai-2:27b via http://127.0.0.1:11434; interview = same model, raw call outside harness; cross-check = deterministic vs trace events.

## Ranked frictions (by summed impact across tasks)

| surface | count | max impact | Σ impact | recovered% | tasks | model's fix idea |
|---|---|---|---|---|---|---|
| sandbox | 1 | 5 | 5 | 0% | f-allowlist-nohint | Allow the task-specified absolute path /tmp/ra-introspect/hash in the sandbox, or provide a tool that can create/write to that exact path. |
| output-format | 1 | 5 | 5 | 0% | f-allowlist-nohint | Ensure the harness can create the required files at /tmp/ra-introspect/hash so the final answer can report success. |
| tool-availability | 1 | 3 | 3 | 100% | f-allowlist-nohint | Provide a working code-execute invocation with a valid language, or allow shell-execute to access the required path. |

## Blind spots (objective harness events the model did NOT report)

- `verification` fired in 1 task(s) with no self-report — harness communication failure


## Per-task

### f-allowlist-nohint — Deliverable blocked by an allowlist gap that gives the model NO recovery hint
- run `01M5NVMVEAHT4V74GK60EZT9EG` success=false iters=7/? terminatedBy=controller_early_stop:dispatcher_early_stop (127s, 16341 tok)
- objective: 4 tool errors, 0 injected signals, 1 verifier rejections
- self-verdict: failed | deliverable_ok=false | one_ask: Allow shell-execute or file-write to create and write to the exact task-specified path /tmp/ra-introspect/hash, or expose a sandbox path mapping that makes that path writable.
- cross-check: mentionRate=80% blind=[verification] unverifiable=[]
  - **sandbox** (impact 5): wanted "Create the directory /tmp/ra-introspect/hash and write note.txt and answer.txt there using…" → "shell-execute rejected absolute path /tmp/ra-introspect/hash as outside the sandbox, and file-write rejected the same pa…" → help: "Allow the task-specified absolute path /tmp/ra-introspect/hash in the sandbox, or provide a tool that can create/write t…"
  - **tool-availability** (impact 3): wanted "Run sha256sum and stat to compute the checksum and size of the created file." → "code-execute initially failed because the language parameter was not one of the allowed values, and shell-execute was bl…" → help: "Provide a working code-execute invocation with a valid language, or allow shell-execute to access the required path."
  - **output-format** (impact 5): wanted "Return a final answer that the verifier accepts as successful." → "The verifier rejected the final answer because action-success was false, likely because the required files were not actu…" → help: "Ensure the harness can create the required files at /tmp/ra-introspect/hash so the final answer can report success."
  - denial: `mkdir -p /tmp/ra-introspect/hash` → "Absolute path "/tmp/ra-introspect/hash" is outside the sandbox (/tmp/rax-sandbox-6e637ab2-61b2-408d-9d90-bc182f0dcf24) — outside the sandbox"
  - denial: `code-execute` → "[Tool error: Parameter "language" must be one of: javascript, typescript → Code execution failed. Review the error and fix the code.]

[Reco…"
  - denial: `file-write` → "[Tool error: File write failed: Path traversal detected: /tmp/ra-introspect/hash/note.txt resolves to /tmp/ra-introspect/hash/note.txt, outs…"
  - denial: `mkdir -p /tmp/ra-introspect/hash && printf 'introspection probe' > /tmp/ra-intro…` → "Absolute path "/tmp/ra-introspect/hash" is outside the sandbox (/tmp/rax-sandbox-6e637ab2-61b2-408d-9d90-bc182f0dcf24) — outside the sandbox"

## Model one-asks (raw)
- **f-allowlist-nohint**: Allow shell-execute or file-write to create and write to the exact task-specified path /tmp/ra-introspect/hash, or expose a sandbox path mapping that makes that path writable.