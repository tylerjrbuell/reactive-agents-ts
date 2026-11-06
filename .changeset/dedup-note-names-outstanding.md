---
"@reactive-agents/reasoning": patch
---

The note an agent gets when it repeats an identical tool call no longer tells it to give a final answer while work is still outstanding. Before, the note said "Already done — do NOT repeat. Give FINAL ANSWER if all steps are complete." even with declared output files still unwritten. It now lists what is outstanding (required tools not yet called, unmet delivery conditions such as an unwritten file), using the same list the exit gate uses. When nothing is outstanding, the final-answer hint is unchanged.
