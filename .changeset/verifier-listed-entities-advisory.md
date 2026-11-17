---
"@reactive-agents/reasoning": patch
---

The fabricated-listed-items check no longer flags a correct answer that labels its own steps with single bold words (for example "**Multiplication**", "**Division**", "**Addition**") or with a bold label followed by a colon. It still flags invented multi-word titles that appear nowhere in the tool evidence. A warn-only verifier result is now logged as an advisory note that says the answer was kept, not as "terminal output rejected". "Rejected" now appears only when the verifier actually rejects the answer.
