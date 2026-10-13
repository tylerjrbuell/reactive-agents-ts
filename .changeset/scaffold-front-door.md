---
"create-reactive-agent": patch
---

Scaffold front-door fixes (Local-Tier Reliability W0.1 + W0.2). Generated projects now pin `^<this package's own stamped version>` for `reactive-agents` instead of the stale hardcoded `^0.14.0` fallback that scaffolded projects too old to compile the template APIs. This drift is now a release error: `scripts/release.ts` fails on a reintroduced version literal, a missing scaffold stamp target, or a post-stamp version mismatch. A keyless run no longer relies on manual exports either: the generated entry (tsx/Node arm) reads `.env` via `process.loadEnvFile` in a try/catch, and a missing provider key prints a named instructive error pointing at `.env` / `.env.example` and exits 1 instead of crashing. README setup wording updated; bun's automatic `.env` load documented.
