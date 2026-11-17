---
"@reactive-agents/eval": patch
"@reactive-agents/verification": patch
"@reactive-agents/judgment": patch
---

README rewrite for eval and verification, and a first README for judgment, following the package README standard: pitch, stability tier, install, a runnable example, API table, docs link, runtime and license. Fixes the dead eval docs link and removes a verification config example that did not match the real builder options. README code examples now type-check (eval cases carry the required `name`, verification sets the model with `.withModel`).
