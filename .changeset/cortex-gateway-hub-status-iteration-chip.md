---
"@reactive-agents/cortex": patch
---

Fix state the UI showed that disagreed with live state. The Lab Gateway tab now reads channels hosted by the channel hub from the hub's own status, so a running Telegram agent shows Connected with its real message counts, last message and reply times, a listening phase, hub traffic in its activity and the access line from its routes (it read "Not started / No channels running / 1 need attention" before). The chat quick bar keeps the steps and strategy chips after you pick a value equal to the default (choosing 16 steps made the chip vanish). A saved agent's run count now comes from its recorded runs (a Telegram agent answering through the channel hub showed "0 runs" beside real stats). The route editor gains the pacing field (`minGapMs`), and the hub header shows outbox and follow-up timer counts when the router keeps them.
