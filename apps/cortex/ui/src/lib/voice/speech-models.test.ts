import { describe, expect, test } from "bun:test";
import { CUSTOM_MODEL, languagesLine, modelSelectOptions, needsDownload, parseSpeechModels } from "./speech-models.js";
import { voiceApi } from "./voice-api.js";

const models = parseSpeechModels({
  installed: [{ id: "Systran/faster-whisper-small", languages: ["en", "de", "fr"] }],
  available: [{ id: "speaches-ai/piper-en_US-amy-low", languages: ["en"], voices: 1 }, { id: 7 }],
  listed: true,
});

describe("speech model picker", () => {
  test("parses the server lists and drops entries without an id", () => {
    expect(models.installed.map((m) => m.id)).toEqual(["Systran/faster-whisper-small"]);
    expect(models.available).toEqual([{ id: "speaches-ai/piper-en_US-amy-low", languages: ["en"], voices: 1 }]);
    expect(parseSpeechModels("nope")).toEqual({ installed: [], available: [], listed: false });
  });

  test("options: installed, downloadable, the unlisted current id kept, and a custom choice", () => {
    const opts = modelSelectOptions(models, "my/own-model");
    expect(opts.map((o) => [o.group, o.value])).toEqual([
      ["Saved", "my/own-model"],
      ["Installed", "Systran/faster-whisper-small"],
      ["Download", "speaches-ai/piper-en_US-amy-low"],
      ["Other", CUSTOM_MODEL],
    ]);
    expect(opts[2]?.description).toBe("Downloads when you save, English only, 1 voice");
    expect(modelSelectOptions(models, "Systran/faster-whisper-small")[0]?.group).toBe("Installed");
  });

  test("languages in a few words", () => {
    expect(languagesLine(["multilingual"])).toBe("Multilingual");
    expect(languagesLine(["en", "de"])).toBe("2 languages");
    expect(languagesLine([])).toBe("");
  });

  test("only a listed, not-installed model needs a download", () => {
    expect(needsDownload(models, "speaches-ai/piper-en_US-amy-low")).toBe(true);
    expect(needsDownload(models, "Systran/faster-whisper-small")).toBe(false);
    expect(needsDownload(models, "other/x")).toBe(false);
  });

  test("the api client asks the models route per direction", async () => {
    const seen: string[] = [];
    const api = voiceApi("http://cortex.test", async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ installed: [], available: [], listed: true }), { status: 200 });
    });
    const r = await api.models("tts");
    expect(r.ok && r.value.listed).toBe(true);
    expect(seen).toEqual(["http://cortex.test/api/voice/models/tts"]);
  });
});
