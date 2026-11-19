---
"@reactive-agents/cortex": patch
---

Cortex chat: Stop and Pause show "Stopping…" / "Pausing…" the moment they are pressed, and editing or sending right after a Stop no longer fails with "Chat session is busy: a turn is already in flight". The stop route now answers once the aborted turn has released the session (bounded at 8s, `settled` in the answer), and a history change or send that arrives while a stop is still winding down waits for the release instead of failing. A busy answer that still slips through reads as plain words.
