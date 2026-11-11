---
"@reactive-agents/cortex": patch
---

Cortex Bench polish from a live QA pass (Beacon, Chat, Runs, run view, Lab, Settings, Model page at 1280, 768 and 1920, dark and light, reduced motion).

- Beacon Field: nodes no longer overlap. Each node takes its own slot sized to the Field, sub-agents sit in the row under their parent, and the Field scrolls when there are more agents than one screen holds. Only positions you drag are remembered; Arrange forgets them and re-groups delegation trees, then state lanes. The legend stays readable over scrolled nodes.
- Chat: below 1024px the session list is a drawer (at 768px it took a third of the width); the top-bar sessions button shows only when it does something.
- Chat `/tools` and the Tools settings list a selected tool Cortex does not offer (for example `calculator` from an older config) so it can be removed; before, it showed in the chip but could not be unticked.
- An abstained reply that already explains why no longer repeats the reason in the note under it.
- Run view: a chat run is titled by the message, not `--- Conversation history ---`; the trace shows one row per loop when the framework reports an iteration twice, and replay counts loops the same way; a run stopped or terminated before it reported completion shows its real duration; while the run loads, the trace, entropy and debrief say "Loading the run…" instead of "no loops recorded".
- The Answer preview drops markdown rules, list and quote markers and table rules, and keeps inline code text.
- The approval toast names the call and whether it came from a chat or a desk run, not the agent's id.
- The chat busy bar no longer animates while hidden.
