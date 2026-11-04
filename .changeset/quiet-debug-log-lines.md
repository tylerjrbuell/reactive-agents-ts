---
"@reactive-agents/observability": patch
---

Debug log lines (for example "Direct strategy completed (1 iter cap)") no longer print to the console on a default run. They are still recorded for subscribers and the run summary, and print live when you ask for debug output with `logging.minLevel: "debug"` or debug verbosity. This matches the documented `minLevel` default of `info`.
