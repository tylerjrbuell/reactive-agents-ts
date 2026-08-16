---
"@reactive-agents/observability": patch
---

Fixed — a plain script (no readline) could hang forever after `agent.run()` returned

On a TTY, the status renderer's stdin cleanup called `resume()` on exit
regardless of whether a host `readline` interface was still using stdin.
For a bare script with no readline of its own, that left stdin actively
flowing with nothing left to consume it — keeping the process alive
indefinitely instead of exiting after the run completed.
