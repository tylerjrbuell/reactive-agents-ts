---
"@reactive-agents/runtime": patch
---

A streamed durable run that is aborted while a Pause is still pending is now stored as `paused` / `user-paused` instead of `stopped` / `user-stopped`. An abort that arrives first, or a Stop/terminate, still stores `user-stopped`.
