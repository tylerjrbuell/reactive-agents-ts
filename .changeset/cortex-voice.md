---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Cortex can listen and speak. The chat composer has a mic button (click to start and stop, or push to talk) that puts what you say into the box at the cursor without touching what you typed, with an optional send after a quiet moment. Every agent reply, the run view's Answer and the whole conversation can be read aloud, a sentence at a time, with play/pause, speed, voice and the sentence highlighted; code blocks and tables are announced, not read. A hands-free voice mode listens, sends on silence, reads the reply and listens again, with barge-in, an always-visible Stop and Interrupt, and approvals and questions left to a click. Settings · Voice picks an engine per direction: the browser's own (default, nothing to install) or any OpenAI-compatible `/audio/transcriptions` and `/audio/speech` endpoint (local faster-whisper-server, whisper.cpp, Kokoro, Piper wrappers, or a cloud), with presets, a Test button each and honest status lines. Endpoint keys are saved in the encrypted key store and never reach the browser; Cortex relays audio and stores none.

`@reactive-agents/ui-core` adds the framework-agnostic voice layer (additive): `SttEngine` / `TtsEngine`, browser and remote engines, `createDictation` / `applyDictation`, `createReadAloud`, `speakableOf` / `chunkSpeech` / `isEcho` / `locateInText`, and the pure voice-mode reducer `voiceModeReduce` with `IDLE_VOICE_MODE`.

Cortex also drops two bridges the framework no longer needs: `AgentSession.chat` / `runStream` take text plus content parts directly, and `listPendingApprovals` rows carry `subAgent`.
