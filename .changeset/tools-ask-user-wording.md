---
"@reactive-agents/tools": patch
---

`request_user_input` no longer tells the model the run "suspends durably". A live answer continues the same run, so the description now says the run waits until the user responds. The new wording is true on both the live and the durable path.
