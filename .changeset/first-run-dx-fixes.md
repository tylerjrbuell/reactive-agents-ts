---
"create-reactive-agent": patch
"@reactive-agents/cli": patch
---

First-run fixes for scaffolded projects and `rax`:

- Scaffolded templates print a failed `build()` or `run()` (a rejected API key, Ollama not running) as one `Error: ...` line and exit 1, instead of a source frame and stack trace. The `streaming` template now exits 1 when the run fails (it printed `[done]` and exited 0), and the `cloudflare-worker` template answers a provider failure with a JSON `{ error }` and status 502.
- `with-approval-gates`: off a TTY (CI, a pipe) the run stops at the first gated call and prints that it is paused, rather than denying and resuming over and over. It prints the real outcome (`result.outcome`, or `result.status` while paused) instead of `Status: undefined`.
- `create-reactive-agent` exits 1 with the list of valid values on an unknown `--template`, `--provider` or `--pm`, instead of falling back to a default.
- The default Ollama model is `qwen3:4b`, the model the docs quickstart pulls, and the next steps and README name `ollama pull qwen3:4b`.
- `rax --help` lists every `rax diagnose` subcommand, including `signals`, `cause` and `attribute`. The banner and `rax --version` print no color when `NO_COLOR` is set or stdout is not a TTY, and `NO_COLOR` now also turns off every other colored `rax` output.
- `rax demo` finds Ollama through the same variables the provider reads (`OLLAMA_ENDPOINT`, then `OLLAMA_HOST`, then `OLLAMA_BASE`), and its Gemini model matches the scaffolder (`gemini-2.5-flash`).
