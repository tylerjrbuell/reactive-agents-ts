---
"@reactive-agents/core": minor
---

Plans are portable: `planToMarkdown`/`planFromMarkdown` (lossless GFM checklist with a front-matter block; also reads hand-edited Markdown), `planToJSON`/`planFromJSON` (schema-validated, versioned envelope) and `planToHtml` (self-contained, escaped, print-friendly). Parsers return `Either<Plan, PlanParseError>` and never throw.
