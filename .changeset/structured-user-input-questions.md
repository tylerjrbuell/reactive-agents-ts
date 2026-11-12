---
"@reactive-agents/tools": minor
---

`request_user_input` accepts a `questions` list: several typed questions in one call (text, single-choice, multi-choice, boolean, number) with options, required, default, min/max, maxLength and allowOther. New `parseRequest`, `validateAnswers`, `timeoutAnswer` and `formatAnswerErrors` turn the host's answers into a typed map keyed by question id, with per-question and overall status, and reject invalid answers with per-question errors the agent can fix. The old `kind` / `prompt` / `schema` call still works and is normalized to the same questions. Hosts must call these helpers to use the new shape (the interaction layer wiring is separate).
