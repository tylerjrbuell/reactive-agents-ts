---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Multimodal task input: `agent.run`, `runStream`, `runEffect` and `chat` accept `string | ContentPart[]` (text, image, audio, file parts). Image parts reach the provider request. A model known not to accept images (probe or static capability table) fails fast with a typed `UnsupportedModalityError { partType, model }` before any model call; audio fails the same way when `supportsAudioIn` is explicitly false. Text-only runs are unchanged. New exports: `TaskInput`, `modelInputCapabilities(provider, model)` (`{ vision, audioIn?, authoritative }`), `UnsupportedModalityError`, `taskInputText`, `taskInputParts`.
