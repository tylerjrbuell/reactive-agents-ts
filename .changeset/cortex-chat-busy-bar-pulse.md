---
"@reactive-agents/cortex": patch
---

The thin loading bar at the top of a chat session now sweeps for the whole time a reply runs (it was wired only to history actions such as rewind and compact, so it sat still during runs). It is indeterminate, calmer while a Stop or Pause waits on the server, and shows a steady accent line under reduced motion.
