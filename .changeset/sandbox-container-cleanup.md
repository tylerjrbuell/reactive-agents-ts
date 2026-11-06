---
"@reactive-agents/tools": patch
---

Docker sandbox containers no longer outlive their tool call. Previously a timeout or a cancelled run could leave `rax-sandbox-*` containers behind. A timeout that fired while `docker run` was still creating the container left a never-started container in `Created` state, which `--rm` does not remove. A cancelled `shell-execute`/`code-execute` call also never reached the running container.

Sandbox runs are now two-phase: `docker create`, then `docker start -a`. A forced `docker rm -f` runs on success, failure, timeout and fiber interruption. Tool-call cancellation now propagates into the sandbox. `--rm` is always set: `DockerSandboxConfig.autoRemove` is deprecated and ignored. Every container carries `rax.sandbox=1`, `rax.sandbox.owner` and `rax.sandbox.deadline` labels. A best-effort background reaper removes stale labeled containers (exited, or past their deadline plus 60s) left by crashed processes. It never touches unlabeled containers.
