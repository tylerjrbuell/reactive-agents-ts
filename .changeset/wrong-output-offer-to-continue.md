---
"@reactive-agents/reasoning": patch
---

An answer that ends by asking permission to go on ("Would you like me to proceed with fixing the remaining modules?", "Shall I continue?") is now treated as a continuation, not a delivered answer: the exit gate asks the model once to write the final answer, and the verifier's `output-not-continuation-intent` check rejects it. A trailing courtesy line does not hide the offer. Offers of something extra on finished work ("Would you like me to provide more details?") still count as answers.
