---
"@reactive-agents/runtime": patch
---

A bare `.withObservability()` shows more again, and a failed `run()` prints one readable error.

- `.withObservability()` with no options no longer counts as `verbosity: "minimal"`. Verbosity stays unset, so it follows stdout: `"normal"` in a terminal (live status line and build-info line on), `"minimal"` when piped (warnings and errors still print). Only an explicit `withObservability({ verbosity: "minimal" })` turns the status line off in a terminal. `toConfig()` no longer emits a `verbosity` you did not set.
- An uncaught `run()` rejection, such as a typo'd or revoked API key at a top-level `await`, now prints one error with one source frame. Before, Bun also printed the error's `cause` and its internal `_originalTaggedError` as two more stacked frames. Both stay available: `err.cause` is still the full unwrapped error, and `_originalTaggedError` is still on it (now non-enumerable).
