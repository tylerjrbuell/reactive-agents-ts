---
"@reactive-agents/trace": patch
---

Failure attribution no longer reports `harness:tool-call-dropped` for calls that ran. A native call and the tool event that ran it now match when the tool name differs only by alias (`file_write` vs `file-write`) or the model path is a directory root (`.`) the tool resolved to the absolute task directory. One `canonTool`/`sameTool` normalizer is used at every tool-name comparison in attribution.
