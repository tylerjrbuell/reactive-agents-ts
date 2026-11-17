---
"@reactive-agents/reasoning": patch
---

Declared deliverables are derived only from the user's instruction. Host-attached context wrapped in `--- Attached file: <label> ---` ... `--- End attached file ---` is ignored when deriving "produce the file X" goals, and a task naming more than 8 file paths declares none instead of dozens of junk goals.
