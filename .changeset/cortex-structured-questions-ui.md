---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": patch
---

Cortex shows a multi-part `request_user_input` as a form (pick one, pick many, yes or no, number, text) in the streaming chat turn, a paused chat turn and "Waiting on you", and sends the answers as one id-keyed map. The server checks the map against the asked questions first and returns what to fix instead of failing inside the run. Voice mode answers the required questions one at a time with the usual read-back and confirm, then sends them together. Older single-question asks work as before. ui-core's `PendingInteractionWire` and `InteractionRequested` gain an optional `questions` field (new types `InteractionQuestionWire`, `InteractionQuestionOptionWire`).
