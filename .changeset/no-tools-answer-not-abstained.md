---
"@reactive-agents/reasoning": patch
---

A plain question-and-answer run with no tools is no longer labelled `abstained` just because the harness ended it (for example at `max_iterations` or on loop detection). Such a run had no tools to gather evidence with, so a substantive answer it gives now keeps its own status, capped at `partial` as before when the harness forced the end. A run that gives up ("I cannot do this") or claims an action it could not have taken ("the message was sent") is still `abstained`. Runs that had tools available, or a required tool, are unchanged.
