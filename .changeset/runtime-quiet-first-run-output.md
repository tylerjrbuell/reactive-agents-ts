---
"@reactive-agents/runtime": patch
---

Piped runs and `verbosity: "minimal"` runs now print the answer alone.

- The `✓ Provider: … | Model: … | API key: …` line after `build()` follows the same verbosity rule as phase lines. It prints in a terminal, and when you set `withObservability({ verbosity: "normal" })` or higher. A piped run with no verbosity set (`| cat`, CI, a server) and any `"minimal"` run skip it.
- The live status line no longer turns on when verbosity is `"minimal"`. `logging: { mode: "status" }` still forces it on.
- Builder notices, such as `withTools: unknown option …` and the bare `.withTools()` "no capability tools" notice, print as one `⚠ <message>` line on stderr. Before, they printed as Effect logfmt on stdout (`timestamp=… level=WARN fiber=#N message=…`). Build validation warnings use the same channel.
