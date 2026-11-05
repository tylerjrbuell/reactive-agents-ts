---
"@reactive-agents/reasoning": patch
---

Reflexion's improve passes now continue the run instead of starting over. Each improve pass adopts the run contract the first pass compiled and starts from the run ledger so far. Before, every improve pass compiled its own contract from the harness's improve prompt, which invented requirements the task never asked for (a `create-ticket` action, a malformed `artifact:.//tmp/...` path). It also judged only its own ledger, so a file the first pass already wrote stayed outstanding.
