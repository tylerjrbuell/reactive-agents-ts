---
"@reactive-agents/reactive-intelligence": minor
"@reactive-agents/runtime": patch
"@reactive-agents/tools": patch
---

`SkillResolverService.resolve()` now returns `activatable`, a map from skill name to what `activate-skill` needs to load that skill: `body`, `sha256` (of the body), `version` and `source`. A filesystem skill also carries its directory (`dir`) and its bundled `resources`. A learned or promoted skill from the skill store carries its stored instructions as the body and no directory, so `file` reads for it are refused. The map has exactly the same names as `catalog`, because one function (`buildSkillCatalog`, now exported) builds both. Before this, learned and promoted skills were listed in `<available_skills>` but could not be activated. New exports: `buildSkillCatalog` and the type `ActivatableSkill`.

Removed: `injectSkill`, `SKILL_TIER_BUDGETS`, `sortByEvictionPriority`, `isSkillContent`, `extractSkillNames` and the type `InjectionResult`. Nothing in the framework called them; skills are now loaded with `activate-skill`. Also removed: the `catalogOnlyHint` option of `generateCatalogXml`, which was already ignored.
