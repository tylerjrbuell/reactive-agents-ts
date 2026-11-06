---
"@reactive-agents/cli": patch
---

`rax eval gate --activations <n>`: pass how many candidate runs the mechanism under test actually acted in. `0` books the ledger entry `void` (an A/A comparison measures nothing) and exits 2 instead of failing as a reject.
