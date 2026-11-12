---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Cortex shows live questions, typed results and how they were obtained. A chat turn whose agent calls `request_user_input` shows the question inline (yes or no, options, form fields or free text) and the same turn carries on with your answer; desk runs list the question under Waiting on you. A run or chat turn with an output schema shows its object as a table of fields (Raw JSON one click away) with a "How output was obtained" panel from the framework's structured-output report (layer, repairs, failed fields as JSON Pointers). Lab gets an Output schema section, and Variables and the schema share one field editor (name, type, description, required); the schema is now plain JSON Schema in the agent's config. Lab Memory and Skills pick an agent through a searchable combobox (named agents first, no raw ids, capped list, stale loads cancelled) instead of a native select. The prompt-library popover lists every saved prompt. ui-core adds `StructuredOutputReported`, `StreamCompleted.object/objectError/objectReport`, `foldStructured`, `fieldRowsOf`, `obtainedOf`, `fieldsToJsonSchema` and `jsonSchemaToFields`.
