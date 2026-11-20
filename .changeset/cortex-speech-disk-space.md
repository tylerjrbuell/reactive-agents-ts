---
"@reactive-agents/cortex": patch
---

Settings · Voice now says when a local Speaches model download fails because Docker's disk is full ("no space left on device"), with the free space the container sees and the fix (raise Docker Desktop's disk limit, or `docker system df` / `docker system prune`, which keeps the model volume). Cortex shows the model cache's free space on Docker's disk and refuses to start a model download with under 1 GiB free.
