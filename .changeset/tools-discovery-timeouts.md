---
"@reactive-agents/tools": patch
---

discover-tools no longer answers "No tools registered." when the run's permitted catalog is empty but tools are registered; it says no tools are available in this run and that tools not enabled for the run are not listed (an optional `getUnlistedToolCount` lets callers report the exact count). Host `shell-execute` now kills the whole process group on timeout, so a pipeline member holding stdout cannot keep the call open past the limit, and a timed-out result carries `timedOut: true` and a short `note`. git-cli, gh-cli, gws-cli, code-execute and docker-execute definitions now time out 2s after the handler's own kill, so the handler's result wins the race instead of a bare ToolService timeout.
