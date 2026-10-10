---
"@reactive-agents/tools": patch
---

File tools now fail helpfully instead of just refusing. A path that escapes the working root is still refused every time, but the rejection names the working root, states the relative-path rule, and suggests the deepest in-root suffix match when one exists, so the next call can be the right one instead of another guess (previously a hallucinating model could burn several rejected calls per run). `confinePath()` is now the single confinement point for file-read, file-write, and directory listing, and the file tool schemas say relative-to-root outright.
