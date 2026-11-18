---
"@reactive-agents/runtime": patch
---

When stdout is not a TTY and verbosity is not set, live warnings and errors now print to stderr, not stdout. Piped output (`agent | jq`) now gets only the answer.
