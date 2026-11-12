---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": patch
---

Read-aloud no longer toasts "Could not reach Cortex for speech: The play() request was interrupted" when playback is interrupted (pause, element removed, next utterance). An interrupted `play()` is a normal stop; a user pause stays paused, other interruptions end the utterance. Other playback failures now say "The audio could not be played." instead of blaming the server connection.
