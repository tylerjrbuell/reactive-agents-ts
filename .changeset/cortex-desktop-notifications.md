---
"@reactive-agents/cortex": patch
---

Desktop notifications now fire. Settings · Notifications only saved a preference and sent a test; nothing listened to runs, approvals or questions, so no real event ever notified. A finished or failed run, an approval waiting on you and a question from an agent now notify (per the chosen level) when Cortex is in the background, whichever page or server-side trigger started the work. The level applies at once, browser permission is what enables notifications, and the Send a test button uses the same path as real events.
