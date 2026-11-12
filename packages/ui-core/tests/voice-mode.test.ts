import { describe, expect, test } from "bun:test";
import {
  BARGE_IN_MIN_CHARS,
  IDLE_VOICE_MODE,
  MAX_EMPTY_LISTENS,
  voiceModeReduce,
  type VoiceModeEffect,
  type VoiceModeEvent,
  type VoiceModeState,
} from "../src/index.js";

/** Run events in order; returns the final state and every effect, in order. */
function run(events: readonly VoiceModeEvent[], from: VoiceModeState = IDLE_VOICE_MODE) {
  let state = from;
  const effects: VoiceModeEffect[] = [];
  for (const e of events) {
    const r = voiceModeReduce(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}
const types = (effects: readonly VoiceModeEffect[]) => effects.map((e) => e.type);

describe("voice mode loop", () => {
  test("start opens the mic; heard sends and closes it; reply speaks; speech end re-listens", () => {
    const a = run([{ type: "start" }]);
    expect(a.state.phase).toBe("listening");
    expect(types(a.effects)).toEqual(["start-listening"]);

    const b = run([{ type: "heard", text: " what is up " }], a.state);
    expect(b.state.phase).toBe("thinking");
    expect(b.state.micOn).toBe(false);
    expect(b.effects).toEqual([{ type: "stop-listening" }, { type: "send", text: "what is up" }]);

    const c = run([{ type: "reply", text: "All **good**." }], b.state);
    expect(c.state.phase).toBe("speaking");
    expect(c.state.speaking).toBe("All good.");
    expect(c.effects).toEqual([{ type: "speak", text: "All **good**." }, { type: "start-listening" }]);

    const d = run([{ type: "speech-ended" }], c.state);
    expect(d.state.phase).toBe("listening");
    expect(d.effects).toEqual([]); // the mic stayed open for barge-in
  });

  test("with barge-in off the mic stays shut while speaking and reopens after", () => {
    const base = run([{ type: "settings", bargeIn: false }, { type: "start" }, { type: "heard", text: "hi" }, { type: "reply", text: "Hello." }]);
    expect(base.state.micOn).toBe(false);
    const speak = base.effects.filter((e) => e.type === "start-listening");
    expect(speak.length).toBe(1); // only the initial open
    const after = run([{ type: "speech-ended" }], base.state);
    expect(types(after.effects)).toEqual(["start-listening"]);
  });

  test("autoSpeak off re-listens straight after the reply", () => {
    const r = run([{ type: "settings", autoSpeak: false }, { type: "start" }, { type: "heard", text: "hi" }, { type: "reply", text: "Hello." }]);
    expect(r.state.phase).toBe("listening");
    expect(types(r.effects).at(-1)).toBe("start-listening");
    expect(types(r.effects)).not.toContain("speak");
  });

  test("a reply with nothing speakable is not spoken", () => {
    const r = run([{ type: "start" }, { type: "heard", text: "hi" }, { type: "reply", text: "---" }]);
    expect(r.state.phase).toBe("listening");
    expect(types(r.effects)).not.toContain("speak");
  });

  test("empty heard text changes nothing; heard while thinking is ignored", () => {
    const started = run([{ type: "start" }]).state;
    expect(voiceModeReduce(started, { type: "heard", text: "   " }).state).toBe(started);
    const thinking = run([{ type: "heard", text: "go" }], started).state;
    const again = voiceModeReduce(thinking, { type: "heard", text: "second" });
    expect(again.effects).toEqual([]);
    expect(again.state.phase).toBe("thinking");
  });
});

describe("barge-in", () => {
  const speaking = () =>
    run([{ type: "start" }, { type: "heard", text: "status" }, { type: "reply", text: "The deploy finished without any errors today." }]).state;

  test("speech that is not the voice's own echo stops the reading and listens", () => {
    const r = voiceModeReduce(speaking(), { type: "interim", text: "wait stop" });
    expect(r.state.phase).toBe("listening");
    expect(r.effects).toEqual([{ type: "cancel-speech" }]);
    expect(r.state.micOn).toBe(true);
  });

  test("echo of what is being spoken does not interrupt", () => {
    const r = voiceModeReduce(speaking(), { type: "interim", text: "deploy finished without" });
    expect(r.state.phase).toBe("speaking");
    expect(r.effects).toEqual([]);
  });

  test("a single stray character is not a barge-in", () => {
    expect(BARGE_IN_MIN_CHARS).toBeGreaterThan(1);
    const r = voiceModeReduce(speaking(), { type: "interim", text: "k" });
    expect(r.state.phase).toBe("speaking");
  });

  test("a finished utterance over the voice cancels it and is sent as the next message", () => {
    const r = voiceModeReduce(speaking(), { type: "heard", text: "actually show me the logs" });
    expect(r.state.phase).toBe("thinking");
    expect(r.effects).toEqual([{ type: "cancel-speech" }, { type: "stop-listening" }, { type: "send", text: "actually show me the logs" }]);
  });

  test("echo as a finished utterance is dropped", () => {
    const r = voiceModeReduce(speaking(), { type: "heard", text: "finished without any errors" });
    expect(r.state.phase).toBe("speaking");
    expect(r.effects).toEqual([]);
  });

  test("barge-in off ignores speech while speaking", () => {
    const s = { ...speaking(), bargeIn: false };
    expect(voiceModeReduce(s, { type: "interim", text: "hello there" }).state.phase).toBe("speaking");
    expect(voiceModeReduce(s, { type: "heard", text: "hello there" }).state.phase).toBe("speaking");
  });

  test("the Interrupt control stops the voice and listens", () => {
    const r = voiceModeReduce(speaking(), { type: "interrupt" });
    expect(r.state.phase).toBe("listening");
    expect(r.effects).toEqual([{ type: "cancel-speech" }]);
  });

  test("Interrupt while thinking stops the run and listens", () => {
    const thinking = run([{ type: "start" }, { type: "heard", text: "go" }]).state;
    const r = voiceModeReduce(thinking, { type: "interrupt" });
    expect(r.state.phase).toBe("listening");
    expect(types(r.effects)).toEqual(["stop-run", "start-listening"]);
  });
});

describe("stop", () => {
  test("from listening closes the mic", () => {
    const r = run([{ type: "start" }, { type: "stop" }]);
    expect(r.state.phase).toBe("idle");
    expect(r.effects.at(-1)).toEqual({ type: "stop-listening" });
  });

  test("from thinking stops the run and the mic is already closed", () => {
    const r = run([{ type: "start" }, { type: "heard", text: "go" }, { type: "stop" }]);
    expect(r.state.phase).toBe("idle");
    expect(types(r.effects).slice(-1)).toEqual(["stop-run"]);
  });

  test("from speaking cancels the voice and closes the mic", () => {
    const r = run([{ type: "start" }, { type: "heard", text: "go" }, { type: "reply", text: "Done." }, { type: "stop" }]);
    expect(r.state.phase).toBe("idle");
    expect(types(r.effects).slice(-2)).toEqual(["stop-listening", "cancel-speech"]);
    expect(r.state.micOn).toBe(false);
  });

  test("from an error leaves voice mode, and stop while idle is a no-op", () => {
    const err = run([{ type: "start" }, { type: "mic-error", message: "blocked" }, { type: "stop" }]);
    expect(err.state.phase).toBe("idle");
    expect(voiceModeReduce(IDLE_VOICE_MODE, { type: "stop" }).effects).toEqual([]);
  });

  test("stop keeps the person's settings", () => {
    const r = run([{ type: "settings", autoSpeak: false, bargeIn: false }, { type: "start" }, { type: "stop" }]);
    expect(r.state.autoSpeak).toBe(false);
    expect(r.state.bargeIn).toBe(false);
  });
});

describe("errors, waiting and limits", () => {
  test("a failed reply pauses the mode with the message; Retry listens again", () => {
    const failed = run([{ type: "start" }, { type: "heard", text: "go" }, { type: "reply-failed", message: "model offline" }]);
    expect(failed.state.phase).toBe("error");
    expect(failed.state.notice).toBe("model offline");
    const retried = run([{ type: "retry" }], failed.state);
    expect(retried.state.phase).toBe("listening");
    expect(types(retried.effects)).toEqual(["start-listening"]);
  });

  test("a mic error from any live state ends listening and speech", () => {
    const r = run([{ type: "start" }, { type: "heard", text: "go" }, { type: "reply", text: "Hi there." }, { type: "mic-error", message: "device lost" }]);
    expect(r.state.phase).toBe("error");
    expect(types(r.effects)).toContain("cancel-speech");
  });

  test("a speech failure keeps listening and shows a note", () => {
    const r = run([{ type: "start" }, { type: "heard", text: "go" }, { type: "reply", text: "Hi there." }, { type: "speech-failed", message: "voice server down" }]);
    expect(r.state.phase).toBe("listening");
    expect(r.state.notice).toBe("voice server down");
  });

  test("waiting on an approval is recorded and cleared by the reply", () => {
    const thinking = run([{ type: "start" }, { type: "heard", text: "go" }]).state;
    const waiting = voiceModeReduce(thinking, { type: "waiting", on: "approval" }).state;
    expect(waiting.waitingOn).toBe("approval");
    expect(waiting.phase).toBe("thinking");
    const done = voiceModeReduce(waiting, { type: "reply", text: "Done." }).state;
    expect(done.waitingOn).toBeNull();
  });

  test("an engine timeout re-opens the mic, and a quiet minute ends the mode", () => {
    let s = run([{ type: "start" }]).state;
    for (let i = 1; i < MAX_EMPTY_LISTENS; i += 1) {
      const r = voiceModeReduce(s, { type: "listen-ended" });
      expect(r.effects).toEqual([{ type: "start-listening" }]);
      s = r.state;
    }
    const last = voiceModeReduce(s, { type: "listen-ended" });
    expect(last.state.phase).toBe("idle");
    expect(last.state.notice).toContain("quiet minute");
  });

  test("hearing speech resets the quiet counter", () => {
    let s = run([{ type: "start" }]).state;
    s = voiceModeReduce(s, { type: "listen-ended" }).state;
    s = voiceModeReduce(s, { type: "listen-ended" }).state;
    expect(s.emptyListens).toBe(2);
    s = voiceModeReduce(s, { type: "interim", text: "hello" }).state;
    expect(s.emptyListens).toBe(0);
  });

  test("events that do not apply to the phase change nothing", () => {
    expect(voiceModeReduce(IDLE_VOICE_MODE, { type: "reply", text: "x" }).state).toBe(IDLE_VOICE_MODE);
    expect(voiceModeReduce(IDLE_VOICE_MODE, { type: "speech-ended" }).state).toBe(IDLE_VOICE_MODE);
    const listening = run([{ type: "start" }]).state;
    expect(voiceModeReduce(listening, { type: "start" }).effects).toEqual([]);
    expect(voiceModeReduce(listening, { type: "reply", text: "x" }).state).toBe(listening);
  });
});
