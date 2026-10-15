---
"@reactive-agents/reasoning": patch
---

Fix contract compiler minting task input files as deliverables (GH #251). `deriveDeliverablePaths` no longer admits paths on the deliverable-list intro alone: no-verb candidates now require a write verb before the token, no existential inventory framing ("there are N files"), and no forward read verb consuming the token. A task that names input files then reads them (S3 shape) now compiles only its real output artifact instead of failing runs that did correct work.
