---
"@reactive-agents/cortex": patch
---

Cortex voice mode: the bar has a reading-speed stepper (0.75x to 2x, the saved Settings reading speed, applied from the next sentence and kept), and a question the agent asks while voice mode waits is read aloud and can be answered by voice. Spoken answers are matched deterministically (option names, "the second one", "option B", yes/no, numbers, free text), read back, and sent only after "send it" or a button; approvals are never answered by voice.
