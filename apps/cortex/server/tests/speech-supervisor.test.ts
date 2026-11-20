// Run: bun run repo test apps/cortex/server/tests/speech-supervisor.test.ts
//
// The opt-in supervisor for a local Speaches container, against a fake docker and a fake speech
// server (no docker, no network): down -> start, missing -> run (cpu / cuda flags), restart policy,
// single-flight, backoff cap, models only when missing, refusals (non-loopback, foreign container),
// opt-in off does nothing, and the HTTP routes behind the request guard.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { voiceRouter } from "../api/voice.js";
import { ProviderKeyStore } from "../services/provider-key-store.js";
import { guardConfigFromEnv, guardRequest } from "../request-guard.js";
import {
  createSpeechSupervisor,
  MAX_ATTEMPTS,
  resolveSpeechTarget,
  scrubDockerText,
  SPEECH_CACHE_VOLUME,
  SPEECH_CONTAINER,
  SPEECH_IMAGES,
  type DockerResult,
  type DockerRunner,
  type SpeechSupervisor,
} from "../services/voice/speech-supervisor.js";
import { DEFAULT_VOICE_SETTINGS, VoiceSettingsStore, type LocalSpeechDevice, type VoiceSettings } from "../services/voice/voice-settings.js";
import { applyLocalSpeechConfig } from "../services/voice/local-speech-config.js";
import { listSpeechModels } from "../services/voice/speech-models.js";
import { diskFullSentence, formatBytes, isDiskFullText, MIN_FREE_FOR_DOWNLOAD_BYTES, parseDfAvailableBytes } from "../services/voice/speech-disk.js";

const STT_MODEL = "Systran/faster-whisper-small";
const TTS_MODEL = "speaches-ai/Kokoro-82M-v1.0-ONNX";
const URL_8000 = "http://localhost:8000/v1";

const local = (over: { keep?: boolean; sttUrl?: string; ttsUrl?: string; sttModel?: string; ttsModel?: string; device?: LocalSpeechDevice } = {}): VoiceSettings => ({
  stt: { engine: "server", baseUrl: over.sttUrl ?? URL_8000, model: over.sttModel ?? STT_MODEL },
  tts: { engine: "server", baseUrl: over.ttsUrl ?? URL_8000, model: over.ttsModel ?? TTS_MODEL, voice: "af_heart" },
  localSpeech: { keepRunning: over.keep ?? true, port: 8000, device: over.device ?? "auto" },
});

/** In-memory stand-in for `VoiceSettingsStore`. */
class MemSettings {
  constructor(public value: VoiceSettings) {}
  get = (): VoiceSettings => this.value;
  set = (next: VoiceSettings): boolean => {
    this.value = next;
    return true;
  };
}

interface Container {
  running: boolean;
  policy: string;
  image: string;
  port: number;
}

/** One world: a fake docker daemon and the speech server it controls. */
class World {
  up = false;
  installed = new Set<string>();
  posted: string[] = [];
  container: Container | null = null;
  nvidia = false;
  binary: "ok" | "missing" | "denied" | "daemon-down" = "ok";
  failRun: DockerResult | null = null;
  calls: string[][] = [];
  clock = 1_000_000;
  fetches = 0;
  /** Host port the speech server answers on (IPv4 loopback only, like `--publish 127.0.0.1:<port>:8000`). */
  port = 8000;
  hosts: string[] = [];
  /** KiB free in the model cache as `df -Pk` inside the container reports it. */
  freeKiB = 50 * 1024 * 1024;
  /** When set, a model download answers this instead of 201 (and runs `onPost` first). */
  postFail: (() => Response) | null = null;
  onPost: (() => void) | null = null;

  readonly docker: DockerRunner = {
    run: async (args) => {
      this.calls.push([...args]);
      if (this.binary === "missing") return { code: -1, stdout: "", stderr: "", spawnError: "not-found" };
      if (this.binary === "denied") return { code: 1, stdout: "", stderr: "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock" };
      if (this.binary === "daemon-down") return { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" };
      switch (args[0]) {
        case "inspect":
          return this.container === null
            ? { code: 1, stdout: "", stderr: `Error: No such object: ${SPEECH_CONTAINER}` }
            : { code: 0, stdout: `${this.container.running}|${this.container.policy}|${this.container.image}|8000/tcp=127.0.0.1:${this.container.port},;\n`, stderr: "" };
        case "start":
          if (this.container) this.container.running = true;
          this.up = true;
          return { code: 0, stdout: SPEECH_CONTAINER, stderr: "" };
        case "update":
          if (this.container) this.container.policy = "unless-stopped";
          return { code: 0, stdout: "", stderr: "" };
        case "exec":
          if (this.container === null || !this.container.running) return { code: 1, stdout: "", stderr: `Error response from daemon: container ${SPEECH_CONTAINER} is not running` };
          return {
            code: 0,
            stdout: `Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/vda1         61255492  58000000 ${this.freeKiB}      99% /home/ubuntu/.cache/huggingface/hub\n`,
            stderr: "",
          };
        case "info":
          return { code: 0, stdout: this.nvidia ? '{"nvidia":{"path":"nvidia-container-runtime"},"runc":{"path":"runc"}}' : '{"runc":{"path":"runc"}}', stderr: "" };
        case "run": {
          if (this.failRun) return this.failRun;
          const publish = args[args.indexOf("--publish") + 1] ?? "";
          if (this.container !== null) return { code: 125, stdout: "", stderr: `docker: Error response from daemon: Conflict. The container name "/${SPEECH_CONTAINER}" is already in use.` };
          this.container = { running: true, policy: "unless-stopped", image: args[args.length - 1] ?? "", port: Number(publish.split(":")[1]) };
          this.port = this.container.port;
          this.up = true;
          return { code: 0, stdout: "abc123", stderr: "" };
        }
        case "rm":
          this.container = null;
          this.up = false;
          return { code: 0, stdout: SPEECH_CONTAINER, stderr: "" };
        case "stop":
          if (this.container) this.container.running = false;
          this.up = false;
          return { code: 0, stdout: SPEECH_CONTAINER, stderr: "" };
        default:
          return { code: 2, stdout: "", stderr: "unsupported" };
      }
    },
  };

  readonly fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    this.fetches += 1;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    this.hosts.push(url.hostname);
    // Published on 127.0.0.1 only: [::1] (and an IPv6-first localhost) is refused, as on the owner's machine.
    if (!this.up || url.hostname !== "127.0.0.1" || url.port !== String(this.port)) throw new TypeError("Unable to connect. Is the computer able to access the url?");
    if (url.pathname === "/health") return new Response("OK");
    if (url.pathname === "/v1/models" && (init?.method ?? "GET") === "GET") return Response.json({ object: "list", data: [...this.installed].map((id) => ({ id })) });
    if (url.pathname.startsWith("/v1/models/") && init?.method === "POST") {
      const id = decodeURIComponent(url.pathname.slice("/v1/models/".length));
      this.posted.push(id);
      this.onPost?.();
      if (this.postFail) return this.postFail();
      this.installed.add(id);
      return new Response(null, { status: 201 });
    }
    if (url.pathname === "/v1/audio/speech") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  sleep = async (ms: number): Promise<void> => {
    this.clock += ms;
  };
  now = (): number => this.clock;
  dockerVerbs = (): string[] => this.calls.map((c) => c[0] ?? "");
}

let w: World;
let mem: MemSettings;
let sup: SpeechSupervisor;
const make = (settings: VoiceSettings = local()): SpeechSupervisor => {
  mem = new MemSettings(settings);
  return createSpeechSupervisor({ settings: mem, docker: w.docker, fetch: w.fetch, now: w.now, sleep: w.sleep, healthWaitMs: 5000, backoffBaseMs: 10_000 });
};
beforeEach(() => {
  w = new World();
  sup = make();
});

describe("opt-in", () => {
  it("does nothing while keep-running is off (no docker, no network)", async () => {
    sup = make(local({ keep: false }));
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("disabled");
    expect(w.calls).toEqual([]);
    expect(w.fetches).toBe(0);
    sup.touch();
    expect(w.calls).toEqual([]);
  });

  it("is off by default", () => {
    expect(DEFAULT_VOICE_SETTINGS.localSpeech.keepRunning).toBe(false);
  });
});

describe("bring it back", () => {
  it("starts the existing stopped container, applies the restart policy, downloads missing models", async () => {
    w.container = { running: false, policy: "no", image: SPEECH_IMAGES.cuda, port: 8000 };
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("ready");
    expect(w.calls.find((c) => c[0] === "start")).toEqual(["start", SPEECH_CONTAINER]);
    expect(w.calls.find((c) => c[0] === "update")).toEqual(["update", "--restart", "unless-stopped", SPEECH_CONTAINER]);
    expect(w.calls.some((c) => c[0] === "run")).toBe(false);
    expect(w.posted.sort()).toEqual([STT_MODEL, TTS_MODEL].sort());
  });

  it("creates the container when missing: cpu flags, argv only, loopback publish, restart policy, named cache volume", async () => {
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("ready");
    const run = w.calls.find((c) => c[0] === "run");
    expect(run).toEqual([
      "run", "--detach", "--name", SPEECH_CONTAINER, "--restart", "unless-stopped",
      "--publish", "127.0.0.1:8000:8000",
      "--volume", `${SPEECH_CACHE_VOLUME}:/home/ubuntu/.cache/huggingface/hub`,
      SPEECH_IMAGES.cpu,
    ]);
    expect(run).not.toContain("--gpus");
    expect(run?.some((a) => /privileged|--cap-add|--pid|--network|--user/.test(a))).toBe(false);
  });

  it("picks the cuda image and --gpus all only when docker reports an nvidia runtime", async () => {
    w.nvidia = true;
    await sup.ensure("startup");
    const run = w.calls.find((c) => c[0] === "run");
    expect(run).toContain("--gpus");
    expect(run?.[run.indexOf("--gpus") + 1]).toBe("all");
    expect(run?.[run.length - 1]).toBe(SPEECH_IMAGES.cuda);
  });

  it("publishes the port from the endpoint URL", async () => {
    sup = make(local({ sttUrl: "http://127.0.0.1:8123/v1", ttsUrl: "http://localhost:8123/v1" }));
    await sup.ensure("startup");
    expect(w.calls.find((c) => c[0] === "run")).toContain("127.0.0.1:8123:8000");
  });

  it("a healthy server needs no docker start; a hand-made container without a policy gets one (once)", async () => {
    w.up = true;
    w.installed = new Set([STT_MODEL, TTS_MODEL]);
    w.container = { running: true, policy: "no", image: SPEECH_IMAGES.cuda, port: 8000 };
    expect((await sup.ensure("startup")).phase).toBe("ready");
    expect(w.dockerVerbs()).toEqual(["inspect", "update"]);
    await sup.ensure("timer");
    expect(w.dockerVerbs()).toEqual(["inspect", "update"]);
    expect(w.posted).toEqual([]);
  });

  it("downloads only the models the server lacks", async () => {
    w.up = true;
    w.installed = new Set([STT_MODEL]);
    await sup.ensure("startup");
    expect(w.posted).toEqual([TTS_MODEL]);
    await sup.ensure("timer");
    expect(w.posted).toEqual([TTS_MODEL]);
  });

  it("leaves a hand-made container with the same name but another image alone (no start, stop, rm or run)", async () => {
    w.container = { running: false, policy: "no", image: "evil/image:latest", port: 8000 };
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("failed");
    expect(st.lastError).toContain(`docker rm -f ${SPEECH_CONTAINER}`);
    expect(w.dockerVerbs()).toEqual(["inspect"]);
    w.container.running = true;
    await sup.stopServer();
    expect(await sup.configure({ port: 8123 })).toMatchObject({ ok: true });
    await sup.settled();
    await sup.retry();
    expect(w.dockerVerbs().filter((v) => v !== "inspect" && v !== "info")).toEqual([]);
    expect(w.container).toMatchObject({ image: "evil/image:latest", running: true });
  });

  it("re-creates its own container (allowlisted image) that is published on another port", async () => {
    w.container = { running: true, policy: "unless-stopped", image: SPEECH_IMAGES.cpu, port: 9999 };
    w.port = 9999;
    w.up = true;
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("ready");
    expect(w.calls.find((c) => c[0] === "rm")).toEqual(["rm", "--force", SPEECH_CONTAINER]);
    expect(w.calls.find((c) => c[0] === "run")).toContain("127.0.0.1:8000:8000");
    expect(w.container?.port).toBe(8000);
  });

  it("single-flight: concurrent ensures share one run", async () => {
    const [a, b, c] = await Promise.all([sup.ensure("timer"), sup.ensure("use"), sup.ensure("startup")]);
    expect(a.phase).toBe("ready");
    expect(b.phase).toBe("ready");
    expect(c.phase).toBe("ready");
    expect(w.calls.filter((x) => x[0] === "run")).toHaveLength(1);
  });

  it("reports progress phases while it works", async () => {
    const seen: string[] = [];
    const p = sup.ensure("startup");
    seen.push(sup.status().phase);
    await p;
    seen.push(sup.status().phase);
    expect(seen).toEqual(["checking", "ready"]);
  });
});

describe("failures, backoff and the attempt cap", () => {
  it("explains a missing docker and a permission problem plainly", async () => {
    w.binary = "missing";
    let st = await sup.ensure("startup");
    expect(st.phase).toBe("failed");
    expect(st.lastError).toContain("Docker was not found");
    w.binary = "denied";
    st = await sup.retry();
    expect(st.lastError).toContain("permission denied");
    w.binary = "daemon-down";
    st = await sup.retry();
    expect(st.lastError).toContain("daemon is not running");
  });

  it("backs off, caps at three attempts, and runs again only on Retry", async () => {
    w.binary = "missing";
    await sup.ensure("startup");
    expect(sup.status().attempts).toBe(1);
    const before = w.calls.length;
    await sup.ensure("timer");
    expect(w.calls.length).toBe(before);
    w.clock += 10_001;
    await sup.ensure("timer");
    expect(sup.status().attempts).toBe(2);
    w.clock += 20_001;
    await sup.ensure("use");
    expect(sup.status().attempts).toBe(MAX_ATTEMPTS);
    expect(sup.status().locked).toBe(true);
    const locked = w.calls.length;
    w.clock += 10 * 60_000;
    await sup.ensure("timer");
    await sup.ensure("use");
    expect(w.calls.length).toBe(locked);
    w.binary = "ok";
    const st = await sup.retry();
    expect(st.phase).toBe("ready");
    expect(st.attempts).toBe(0);
    expect(st.locked).toBe(false);
  });

  it("a failed docker run reports only a scrubbed 300-character tail", async () => {
    w.failRun = { code: 125, stdout: "", stderr: `\u001b[31mdocker: Error response ${"x".repeat(900)} port is already allocated\u0000\n` };
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("failed");
    const err = st.lastError ?? "";
    expect(err.length).toBeLessThanOrEqual(300);
    expect(err).toContain("port is already allocated");
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f]/.test(err)).toBe(false);
    expect(scrubDockerText("a\n\n b")).toBe("a b");
  });

  it("fails (and says so) when the container started but the server never answers", async () => {
    w.docker.run = async (args) => {
      w.calls.push([...args]);
      if (args[0] === "inspect") return { code: 1, stdout: "", stderr: "Error: No such object" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("failed");
    expect(st.lastError).toContain("did not answer");
  });
});

describe("a full model cache (Docker's disk)", () => {
  const GiB = 1024 ** 3;
  const own = (): void => {
    w.up = true;
    w.container = { running: true, policy: "unless-stopped", image: SPEECH_IMAGES.cpu, port: 8000 };
  };

  it("an ENOSPC download body becomes the plain sentence with the free space and the fix", async () => {
    own();
    w.postFail = () => new Response('{"detail":"[Errno 28] No space left on device: \'/home/ubuntu/.cache/huggingface/hub/x.incomplete\'"}', { status: 500 });
    w.onPost = () => {
      w.freeKiB = 2 * 1024 * 1024; // the partial file used some; still above the floor
    };
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("failed");
    expect(st.lastError).toBe(diskFullSentence(2 * GiB));
    expect(st.lastError).toContain("Docker's disk is full (2.1 GB free for speech models)");
    expect(st.lastError).toContain("not your computer's");
    expect(st.lastError).toContain("docker system df");
    // Never suggests removing the model cache volume.
    expect(st.lastError).not.toContain(SPEECH_CACHE_VOLUME);
    expect(st.lastError).not.toContain("--volumes");
    expect(st.cache?.freeBytes).toBe(2 * GiB);
  });

  it("an HTTP 500 with a bare body reads as a full disk only when the cache is nearly full after it", async () => {
    own();
    w.postFail = () => new Response("Internal Server Error", { status: 500 });
    let st = await sup.ensure("startup");
    expect(st.lastError).toBe(`Downloading ${STT_MODEL} failed (the speech server answered HTTP 500).`);
    w.onPost = () => {
      w.freeKiB = 10 * 1024;
    };
    w.freeKiB = 50 * 1024 * 1024;
    st = await sup.retry();
    expect(st.lastError).toBe(diskFullSentence(10 * 1024 * 1024));
  });

  it("refuses to start a download when the cache has under the floor free (nothing is posted)", async () => {
    own();
    w.freeKiB = 300 * 1024;
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("failed");
    expect(st.lastError).toBe(diskFullSentence(300 * 1024 * 1024));
    expect(w.posted).toEqual([]);
    expect(MIN_FREE_FOR_DOWNLOAD_BYTES).toBe(GiB);
  });

  it("measures with docker exec df on its own running container only, argv fixed", async () => {
    own();
    await sup.ensure("startup");
    expect(w.calls.find((c) => c[0] === "exec")).toEqual(["exec", SPEECH_CONTAINER, "df", "-Pk", "/home/ubuntu/.cache/huggingface/hub"]);
    // A server that answers without a Cortex container (hand-made elsewhere): no exec, downloads still run.
    w = new World();
    sup = make();
    w.up = true;
    expect((await sup.ensure("startup")).phase).toBe("ready");
    expect(w.dockerVerbs()).not.toContain("exec");
    expect(w.posted.length).toBe(2);
    // Another image under the name: never exec'd into.
    w = new World();
    sup = make();
    w.up = true;
    w.container = { running: true, policy: "no", image: "evil/image:latest", port: 8000 };
    await sup.ensure("startup");
    expect(w.dockerVerbs()).not.toContain("exec");
  });

  it("no measure when nothing is missing", async () => {
    own();
    w.installed = new Set([STT_MODEL, TTS_MODEL]);
    await sup.ensure("startup");
    expect(w.dockerVerbs()).not.toContain("exec");
    expect(sup.status().cache).toBeNull();
  });

  it("a docker call that hits ENOSPC (image pull) says the same sentence", async () => {
    w.failRun = { code: 125, stdout: "", stderr: "docker: failed to register layer: write /usr/lib/x.so: no space left on device." };
    const st = await sup.ensure("startup");
    expect(st.lastError).toBe(diskFullSentence(null));
  });

  it("the sentence fits the 300-character tail rule; df parsing", () => {
    expect(diskFullSentence(999 * 1e9).length).toBeLessThanOrEqual(300);
    expect(scrubDockerText(diskFullSentence(123 * 1e9))).toBe(diskFullSentence(123 * 1e9));
    expect(diskFullSentence(null)).not.toContain("free for");
    expect(parseDfAvailableBytes("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/nvme0n1p7 975319548 750181364 217568396 78% /home/ubuntu/.cache/huggingface/hub\n")).toBe(217568396 * 1024);
    expect(parseDfAvailableBytes("garbage")).toBeNull();
    expect(parseDfAvailableBytes("h\n/dev/x 1 2 -3 4% /m")).toBeNull();
    expect(isDiskFullText("OSError: [Errno 28] No space left on device")).toBe(true);
    expect(isDiskFullText("ENOSPC: write")).toBe(true);
    expect(isDiskFullText("Model not found")).toBe(false);
    expect(formatBytes(350e6)).toBe("350 MB");
  });
});

describe("what gets supervised", () => {
  it("accepts the Speaches presets on loopback", () => {
    const t = resolveSpeechTarget(local());
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.port).toBe(8000);
      expect(t.models).toEqual([STT_MODEL, TTS_MODEL]);
    }
  });

  it.each([
    ["a LAN address", { sttUrl: "http://192.168.1.5:8000/v1", ttsUrl: "http://192.168.1.5:8000/v1" }],
    ["a cloud URL", { sttUrl: "https://api.openai.com/v1", ttsUrl: "https://api.openai.com/v1" }],
    ["https on loopback", { sttUrl: "https://localhost:8000/v1", ttsUrl: "https://localhost:8000/v1" }],
    ["an endpoint with no port", { sttUrl: "http://localhost/v1", ttsUrl: "http://localhost/v1" }],
    ["a privileged port", { sttUrl: "http://localhost:80/v1", ttsUrl: "http://localhost:80/v1" }],
    ["a path other than /v1", { sttUrl: "http://localhost:8000/other", ttsUrl: "http://localhost:8000/other" }],
    ["a host that only starts with localhost", { sttUrl: "http://localhost.evil.test:8000/v1", ttsUrl: "http://localhost.evil.test:8000/v1" }],
    ["a model that is not a Hugging Face id (openedai-speech)", { sttModel: "whisper-1", ttsModel: "tts-1" }],
  ])("refuses %s", async (_name, over) => {
    const s = local(over);
    expect(resolveSpeechTarget(s).ok).toBe(false);
    sup = make(s);
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("unavailable");
    expect(st.eligible).toBe(false);
    expect(w.calls).toEqual([]);
    expect((await sup.setKeepRunning(true)).ok).toBe(false);
    expect(sup.startServer().ok).toBe(false);
  });

  it("refuses listening and reading on different ports", () => {
    expect(resolveSpeechTarget(local({ ttsUrl: "http://localhost:8001/v1" })).ok).toBe(false);
  });

  it("ignores an endpoint whose engine is the browser", () => {
    const s = local();
    const t = resolveSpeechTarget({ ...s, stt: { ...s.stt, engine: "browser" } });
    expect(t.ok && t.models).toEqual([TTS_MODEL]);
  });

  it("the images are an allowlist of exactly two pinned tags", () => {
    expect(Object.values(SPEECH_IMAGES)).toEqual(["ghcr.io/speaches-ai/speaches:latest-cpu", "ghcr.io/speaches-ai/speaches:latest-cuda"]);
  });
});

describe("the HTTP surface", () => {
  let dir: string;
  let store: VoiceSettingsStore;
  const TOKEN = "t0ken-0123456789";
  const build = (opts: { token?: string; allowDocker?: boolean } = {}) => {
    store = new VoiceSettingsStore(dir);
    store.set({ ...local({ keep: false }) });
    const supervisor = createSpeechSupervisor({ settings: store, docker: w.docker, fetch: w.fetch, now: w.now, sleep: w.sleep, healthWaitMs: 3000 });
    const cfg = { ...guardConfigFromEnv({}), ...(opts.token ? { token: opts.token } : {}) };
    const app = new Elysia()
      .onRequest(({ request }) => guardRequest(request, cfg))
      .use(voiceRouter({ settings: store, keys: new ProviderKeyStore({ dir, env: {} }), fetch: w.fetch, supervisor, allowDocker: opts.allowDocker ?? true }));
    return { app, supervisor };
  };
  const req = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
    new Request(`http://127.0.0.1:4321${path}`, { ...init, headers: { "content-type": "application/json", host: "127.0.0.1:4321", ...headers } });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => req(path, { method: "POST", body: JSON.stringify(body) }, headers);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cortex-speech-sup-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("GET status; keep-running persists the opt-in and starts the work", async () => {
    const { app, supervisor } = build();
    const before = (await (await app.handle(req("/api/voice/local/status"))).json()) as { phase: string; keepRunning: boolean; eligible: boolean };
    expect(before).toMatchObject({ phase: "disabled", keepRunning: false, eligible: true });
    const res = await app.handle(post("/api/voice/local/keep-running", { enabled: true }));
    expect(res.status).toBe(200);
    expect(store.get().localSpeech.keepRunning).toBe(true);
    const done = await supervisor.ensure("manual");
    expect(done.phase).toBe("ready");
    expect(w.calls.some((c) => c[0] === "run")).toBe(true);
    w.calls = [];
    const off = await app.handle(post("/api/voice/local/keep-running", { enabled: false }));
    expect(((await off.json()) as { phase: string; running: boolean }).phase).toBe("stopped");
    expect(store.get().localSpeech.keepRunning).toBe(false);
    // Switching it off stops the container (kept for a fast restart, not removed).
    expect(w.calls.find((c) => c[0] === "stop")).toEqual(["stop", SPEECH_CONTAINER]);
    expect(w.dockerVerbs()).not.toContain("rm");
    expect(w.container?.running).toBe(false);
  });

  it("Start and Stop work by hand with keep-running off; Stop also switches keep-running off", async () => {
    const { app, supervisor } = build();
    const started = await app.handle(post("/api/voice/local/start", {}));
    expect(started.status).toBe(200);
    expect((await supervisor.settled()).phase).toBe("ready");
    expect(store.get().localSpeech.keepRunning).toBe(false);
    const st = (await (await app.handle(req("/api/voice/local/status"))).json()) as { phase: string; running: boolean; port: number; endpoint: string };
    expect(st).toMatchObject({ phase: "ready", running: true, port: 8000, endpoint: "127.0.0.1:8000" });

    await supervisor.setKeepRunning(true);
    await supervisor.settled();
    const stopped = await app.handle(post("/api/voice/local/stop", {}));
    expect(((await stopped.json()) as { phase: string; running: boolean })).toMatchObject({ phase: "stopped", running: false });
    expect(store.get().localSpeech.keepRunning).toBe(false);
    expect(w.container?.running).toBe(false);
    // The timer does not bring it back.
    await supervisor.ensure("timer");
    expect(w.container?.running).toBe(false);
  });

  it("GET status carries the model cache's free bytes, measured only where docker is allowed", async () => {
    w.up = true;
    w.container = { running: true, policy: "unless-stopped", image: SPEECH_IMAGES.cpu, port: 8000 };
    w.freeKiB = 4 * 1024 * 1024;
    const denied = build({ allowDocker: false }).app;
    const a = (await (await denied.handle(req("/api/voice/local/status"))).json()) as { cache: unknown };
    expect(a.cache).toBeNull();
    expect(w.dockerVerbs()).not.toContain("exec");
    const { app } = build();
    const b = (await (await app.handle(req("/api/voice/local/status"))).json()) as { cache: { freeBytes: number } | null };
    expect(b.cache?.freeBytes).toBe(4 * 1024 ** 3);
    // Throttled: a second look within a minute runs no docker.
    w.calls = [];
    w.clock += 5_000;
    await app.handle(req("/api/voice/local/status"));
    expect(w.calls).toEqual([]);
  });

  it("config: a port change saves the port, moves the endpoints and re-creates the running container there", async () => {
    const { app, supervisor } = build();
    await app.handle(post("/api/voice/local/start", {}));
    await supervisor.settled();
    w.calls = [];
    const res = await app.handle(post("/api/voice/local/config", { port: 8123 }));
    expect(res.status).toBe(200);
    expect(store.get().localSpeech.port).toBe(8123);
    expect(store.get().stt.baseUrl).toBe("http://127.0.0.1:8123/v1");
    expect(store.get().tts.baseUrl).toBe("http://127.0.0.1:8123/v1");
    expect((await supervisor.settled()).phase).toBe("ready");
    expect(w.calls.find((c) => c[0] === "rm")).toEqual(["rm", "--force", SPEECH_CONTAINER]);
    expect(w.calls.find((c) => c[0] === "run")).toContain("127.0.0.1:8123:8000");
    expect(supervisor.status().port).toBe(8123);
  });

  it("config refuses a bad port or device; start, stop and config answer 403 without docker permission", async () => {
    const { app } = build();
    expect((await app.handle(post("/api/voice/local/config", { port: 80 }))).status).toBe(422);
    expect((await app.handle(post("/api/voice/local/config", { device: "rocm" }))).status).toBe(422);
    const denied = build({ allowDocker: false }).app;
    for (const path of ["/api/voice/local/start", "/api/voice/local/stop", "/api/voice/local/config"]) {
      expect((await denied.handle(post(path, { port: 8123 }))).status).toBe(403);
    }
    expect(store.get().localSpeech.port).toBe(8000);
    expect(w.calls).toEqual([]);
  });

  it("refuses to turn on without a local Speaches endpoint, and a bad body", async () => {
    const { app } = build();
    store.set({ ...DEFAULT_VOICE_SETTINGS });
    expect((await app.handle(post("/api/voice/local/keep-running", { enabled: true }))).status).toBe(400);
    expect((await app.handle(post("/api/voice/local/keep-running", { enabled: "yes" }))).status).toBe(422);
    expect(w.calls).toEqual([]);
  });

  it("the settings PUT cannot flip the opt-in", async () => {
    const { app } = build();
    await app.handle(req("/api/voice/settings", { method: "PUT", body: JSON.stringify({ localSpeech: { keepRunning: true }, stt: { model: STT_MODEL } }) }));
    expect(store.get().localSpeech.keepRunning).toBe(false);
  });

  it("mutating routes sit behind the request guard: token, Host and cross-site", async () => {
    const { app } = build({ token: TOKEN });
    expect((await app.handle(post("/api/voice/local/keep-running", { enabled: true }))).status).toBe(401);
    expect((await app.handle(post("/api/voice/local/ensure", {}))).status).toBe(401);
    expect((await app.handle(req("/api/voice/local/status"))).status).toBe(401);
    expect((await app.handle(post("/api/voice/local/keep-running", { enabled: true }, { authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await app.handle(post("/api/voice/local/keep-running", { enabled: true }, { host: "evil.example", authorization: `Bearer ${TOKEN}` }))).status).toBe(403);
    expect((await app.handle(post("/api/voice/local/keep-running", { enabled: true }, { "sec-fetch-site": "cross-site", authorization: `Bearer ${TOKEN}` }))).status).toBe(403);
    expect(store.get().localSpeech.keepRunning).toBe(false);
    expect(w.calls).toEqual([]);
    expect((await app.handle(post("/api/voice/local/keep-running", { enabled: true }, { authorization: `Bearer ${TOKEN}` }))).status).toBe(200);
  });

  it("answers 403 when this Cortex may not run docker (reachable from elsewhere without a token)", async () => {
    const { app } = build({ allowDocker: false });
    expect((await app.handle(post("/api/voice/local/keep-running", { enabled: true }))).status).toBe(403);
    expect((await app.handle(post("/api/voice/local/ensure", {}))).status).toBe(403);
    expect(store.get().localSpeech.keepRunning).toBe(false);
    expect(w.calls).toEqual([]);
  });

  it("first reading after downtime just works: unreachable -> ensure -> one retry", async () => {
    const { app, supervisor } = build();
    supervisor.setKeepRunning(true);
    await supervisor.ensure("manual");
    expect(supervisor.status().phase).toBe("ready");
    // The container dies; the server is down but the supervisor has not noticed yet.
    w.up = false;
    if (w.container) w.container.running = false;
    w.calls = [];
    const res = await app.handle(post("/api/voice/speak", { text: "Hello." }));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(w.dockerVerbs()).toContain("start");
  });

  it("no recovery when the opt-in is off: the 502 stands and docker is never called", async () => {
    const { app } = build();
    const res = await app.handle(post("/api/voice/speak", { text: "Hello." }));
    expect(res.status).toBe(502);
    expect(w.calls).toEqual([]);
  });

  it("a saved [::1] or localhost endpoint is called as 127.0.0.1 (the container publishes on IPv4 loopback only)", async () => {
    const { app, supervisor } = build();
    store.set(local({ keep: false, sttUrl: "http://[::1]:8000/v1", ttsUrl: "http://[::1]:8000/v1" }));
    await app.handle(post("/api/voice/local/start", {}));
    expect((await supervisor.settled()).phase).toBe("ready");
    const res = await app.handle(post("/api/voice/speak", { text: "Hello." }));
    expect(res.status).toBe(200);
    expect(new Set(w.hosts)).toEqual(new Set(["127.0.0.1"]));
  });

  it("GET /models/:direction lists installed and downloadable models from the speech server", async () => {
    const { app } = build();
    const seen: string[] = [];
    const speaches = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      seen.push(`${url.hostname}${url.pathname}${url.search}`);
      if (url.pathname === "/v1/models") return Response.json({ data: [{ id: STT_MODEL, language: ["en", "de"] }] });
      if (url.pathname === "/v1/registry") return Response.json({ data: [{ id: STT_MODEL }, { id: "Systran/faster-whisper-large-v3", language: ["en"] }, { id: 7 }] });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const app2 = new Elysia().use(voiceRouter({ settings: store, keys: new ProviderKeyStore({ dir, env: {} }), fetch: speaches, supervisor: createSpeechSupervisor({ settings: store, docker: w.docker }), allowDocker: true }));
    const body = (await (await app2.handle(req("/api/voice/models/stt"))).json()) as { installed: { id: string; languages: string[] }[]; available: { id: string }[]; listed: boolean };
    expect(body.listed).toBe(true);
    expect(body.installed).toEqual([{ id: STT_MODEL, languages: ["en", "de"] }]);
    expect(body.available.map((m) => m.id)).toEqual(["Systran/faster-whisper-large-v3"]);
    expect(seen).toEqual(["127.0.0.1/v1/models?task=automatic-speech-recognition", "127.0.0.1/v1/registry?task=automatic-speech-recognition"]);
    expect((await app.handle(req("/api/voice/models/xx"))).status).toBe(400);
  });
});

describe("hardware and port", () => {
  it("cpu never asks docker info or passes --gpus; cuda refuses plainly without an nvidia runtime", async () => {
    sup = make(local({ device: "cpu" }));
    w.nvidia = true;
    await sup.ensure("startup");
    expect(w.dockerVerbs()).not.toContain("info");
    expect(w.calls.find((c) => c[0] === "run")?.at(-1)).toBe(SPEECH_IMAGES.cpu);

    w = new World();
    sup = make(local({ device: "cuda" }));
    const st = await sup.ensure("startup");
    expect(st.phase).toBe("failed");
    expect(st.lastError).toContain("no NVIDIA runtime");
    expect(w.dockerVerbs()).not.toContain("run");
  });

  it("switching hardware re-creates the running container with the other image", async () => {
    w.nvidia = true;
    await sup.ensure("startup");
    expect(w.container?.image).toBe(SPEECH_IMAGES.cuda);
    expect(await sup.configure({ device: "cpu" })).toMatchObject({ ok: true });
    expect((await sup.settled()).phase).toBe("ready");
    expect(w.container?.image).toBe(SPEECH_IMAGES.cpu);
    expect(w.dockerVerbs()).toContain("rm");
  });

  it("a port change with nothing running and keep-running off only saves", async () => {
    sup = make(local({ keep: false }));
    expect(await sup.configure({ port: 8200 })).toMatchObject({ ok: true });
    await sup.settled();
    expect(mem.value.localSpeech.port).toBe(8200);
    expect(mem.value.stt.baseUrl).toBe("http://127.0.0.1:8200/v1");
    expect(w.dockerVerbs()).toEqual(["inspect"]);
  });

  it("applyLocalSpeechConfig moves only the supervised endpoints and refuses a privileged port", () => {
    const s = local({ ttsUrl: "https://api.openai.com/v1", ttsModel: "tts-1" });
    const r = applyLocalSpeechConfig(s, { port: 9000 });
    expect(r.ok && r.settings.stt.baseUrl).toBe("http://127.0.0.1:9000/v1");
    expect(r.ok && r.settings.tts.baseUrl).toBe("https://api.openai.com/v1");
    expect(applyLocalSpeechConfig(s, { port: 80 }).ok).toBe(false);
    expect(applyLocalSpeechConfig(s, {})).toMatchObject({ ok: true, changed: false });
  });

  it("the settings file keeps port and device, and ignores bad values", () => {
    const d = mkdtempSync(join(tmpdir(), "cortex-speech-cfg-"));
    try {
      const store = new VoiceSettingsStore(d);
      store.set(local({ device: "cuda" }));
      expect(store.get().localSpeech).toEqual({ keepRunning: true, port: 8000, device: "cuda" });
      store.set({ ...local(), localSpeech: { keepRunning: true, port: 80, device: "auto" } });
      expect(store.get().localSpeech.port).toBe(8000);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("listSpeechModels never fails: a server without the routes gives empty, unlisted lists", async () => {
    const none = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    expect(await listSpeechModels({ baseUrl: "http://127.0.0.1:8000/v1", fetch: none }, "text-to-speech")).toEqual({ installed: [], available: [], listed: false });
  });
});
