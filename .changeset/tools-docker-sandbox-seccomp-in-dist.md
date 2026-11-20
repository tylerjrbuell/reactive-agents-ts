---
"@reactive-agents/tools": patch
---

npm installs now apply the Docker sandbox seccomp profile. The published package shipped without `sandbox-image/` (the seccomp profile and hardened-image Dockerfiles), so every npm install ran the Docker sandbox without syscall filtering, silently, and `buildSandboxImage()` always returned `false`. The build now copies them to `dist/sandbox-image/`. A missing seccomp profile now fails the sandbox run with a `ToolExecutionError` naming the expected path instead of running unfiltered; set `useSeccomp: false` to opt out explicitly.
