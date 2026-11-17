---
"@reactive-agents/cortex": patch
---

Cortex chat no longer offers Continue for a stopped reply that has no saved run of its own (an older interrupted run of the same agent used to make the card appear while the toast said there was nothing to continue); that case now points at Durable runs. Pause on a chat without Durable runs ends the turn as "stopped", not "paused". "Left to do" in the stop card is a short list. On the webhook channel card, Generate sits in the Signing secret row beside Replace and Remove, the replay rule shows the window as a duration, and the listen port says it has no default.
