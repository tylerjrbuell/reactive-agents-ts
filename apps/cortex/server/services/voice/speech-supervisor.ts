/**
 * Keeps a local Speaches (OpenAI-compatible speech) container running for Settings · Voice.
 *
 * Opt-in only (`localSpeech.keepRunning`, default off, set through `POST /api/voice/local/keep-running`).
 * When on, Cortex checks the endpoint at startup, when voice is used, and on a timer; if it is
 * down it starts the existing container, else creates it, then downloads the configured models
 * through the server's own model API. Docker itself restarts it after a crash or reboot
 * (`--restart unless-stopped`).
 *
 * This runs `docker` on the owner's machine, so the surface is fixed in code, not in settings:
 * - only a loopback endpoint (`localhost`, `127.0.0.1`, `::1`) with an explicit port and a `/v1` path;
 * - one container name (`cortex-speaches`) and two allowlisted image tags, never from input;
 * - argv arrays through the injected `DockerRunner` (real = `execFile`, no shell);
 * - the port is published as `127.0.0.1:<port>:8000`; no privileged flags; the only mount is the
 *   named Hugging Face cache volume; `--gpus all` only when `docker info` lists an nvidia runtime;
 * - a container that already carries the name but a different image or port is left alone;
 * - single-flight, 3 attempts with exponential backoff, then `failed` until Retry;
 * - docker's stderr never leaves here beyond a scrubbed 300-character tail.
 */
import { execFile } from "node:child_process";
import type { VoiceSettings } from "./voice-settings.js";

/** The one container Cortex creates and manages. (A hand-made `speaches` container is never touched.) */
export const SPEECH_CONTAINER = "cortex-speaches";
/** The only images Cortex will run. */
export const SPEECH_IMAGES = {
  cpu: "ghcr.io/speaches-ai/speaches:latest-cpu",
  cuda: "ghcr.io/speaches-ai/speaches:latest-cuda",
} as const;
/** Named volume that caches downloaded models across container re-creations. */
export const SPEECH_CACHE_VOLUME = "hf-hub-cache";
const CACHE_MOUNT = "/home/ubuntu/.cache/huggingface/hub";
/** Port the Speaches image listens on inside the container. */
const INNER_PORT = 8000;
/** Failed attempts before the supervisor stops until Retry. */
export const MAX_ATTEMPTS = 3;

/** Result of one docker call. `spawnError` is set when `docker` could not be started at all. */
export interface DockerResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError?: "not-found" | "permission" | "other";
}

/** The seam to docker. Real: `execDockerRunner`. Tests pass a fake. Arguments are argv entries, never a shell string. */
export interface DockerRunner {
  run(args: readonly string[], timeoutMs: number): Promise<DockerResult>;
}

/** Runs the `docker` binary with `execFile` (no shell). */
export const execDockerRunner: DockerRunner = {
  run: (args, timeoutMs) =>
    new Promise<DockerResult>((resolve) => {
      execFile("docker", [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err === null) return resolve({ code: 0, stdout, stderr });
        const code: unknown = (err as { code?: unknown }).code;
        if (code === "ENOENT") return resolve({ code: -1, stdout, stderr, spawnError: "not-found" });
        if (code === "EACCES") return resolve({ code: -1, stdout, stderr, spawnError: "permission" });
        if (typeof code === "number") return resolve({ code, stdout, stderr });
        return resolve({ code: -1, stdout, stderr: stderr || err.message, spawnError: "other" });
      });
    }),
};

/** Where the supervisor is. `disabled`: opt-in off. `unavailable`: no local Speaches endpoint to supervise. */
export type SpeechPhase = "disabled" | "unavailable" | "checking" | "starting" | "downloading" | "ready" | "failed";

/** Body of `GET /api/voice/local/status`. */
export interface SpeechStatus {
  readonly phase: SpeechPhase;
  /** The opt-in. */
  readonly keepRunning: boolean;
  /** A local Speaches endpoint is configured, so the opt-in can be offered. */
  readonly eligible: boolean;
  /** One plain sentence for the person (never docker output). */
  readonly message: string;
  /** Scrubbed last failure, or null. */
  readonly lastError: string | null;
  readonly attempts: number;
  /** Three failures in a row: nothing runs again until Retry. */
  readonly locked: boolean;
  readonly container: string;
  /** `host:port` being supervised, or null. */
  readonly endpoint: string | null;
  readonly models: readonly string[];
}

/** What the supervisor will keep running, read from the voice settings. */
export type SpeechTarget =
  | {
      readonly ok: true;
      readonly port: number;
      /** `http://<host>:<port>` as the person typed the host. */
      readonly origin: string;
      /** `<origin>/v1`. */
      readonly apiBase: string;
      readonly models: readonly string[];
      readonly directions: readonly ("stt" | "tts")[];
    }
  | { readonly ok: false; readonly reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
/** A Hugging Face model id as Speaches names them: `org/name`. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * The local Speaches endpoint(s) in `settings`, or why there is none. Only server-engine endpoints
 * on a loopback `http://host:port/v1` with a Hugging Face model id qualify (so `tts-1` on an
 * openedai-speech server, or any cloud URL, is never supervised). Listening and reading must share one port.
 */
export function resolveSpeechTarget(settings: VoiceSettings): SpeechTarget {
  const found: { dir: "stt" | "tts"; origin: string; port: number; model: string }[] = [];
  for (const dir of ["stt", "tts"] as const) {
    const s = settings[dir];
    if (s.engine !== "server" || s.baseUrl === "") continue;
    let u: URL;
    try {
      u = new URL(s.baseUrl);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname) || u.username !== "" || u.password !== "") continue;
    if (u.pathname.replace(/\/+$/, "") !== "/v1" || u.search !== "" || u.hash !== "") continue;
    const port = Number(u.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) continue;
    if (!MODEL_ID.test(s.model)) continue;
    found.push({ dir, origin: `http://${u.host}`, port, model: s.model });
  }
  const first = found[0];
  if (first === undefined) {
    return { ok: false, reason: "Set the listening or reading engine to a local Speaches endpoint first (a localhost URL with a port, ending in /v1)." };
  }
  if (found.some((f) => f.port !== first.port)) {
    return { ok: false, reason: "Listening and reading point at different local ports; Cortex keeps one speech server running, so use the same port for both." };
  }
  return {
    ok: true,
    port: first.port,
    origin: first.origin,
    apiBase: `${first.origin}/v1`,
    models: [...new Set(found.map((f) => f.model))],
    directions: found.map((f) => f.dir),
  };
}

/** Control characters out, whitespace collapsed, last 300 characters. */
export function scrubDockerText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `…${flat.slice(-299)}` : flat;
}

function dockerProblem(r: DockerResult): string {
  if (r.spawnError === "not-found") return "Docker was not found on this machine. Install Docker, or start the speech server yourself.";
  if (r.spawnError === "permission" || /permission denied/i.test(r.stderr)) {
    return "Docker refused access (permission denied). Add your user to the docker group or start Docker, then press Retry.";
  }
  if (/cannot connect to the docker daemon|is the docker daemon running|error during connect/i.test(r.stderr)) {
    return "The Docker daemon is not running. Start Docker, then press Retry.";
  }
  const tail = scrubDockerText(r.stderr || r.stdout);
  return tail === "" ? "Docker failed without a message." : `Docker failed: ${tail}`;
}

/** Everything the supervisor reads or calls; every field but `settings` and `docker` has a default. */
export interface SpeechSupervisorDeps {
  readonly settings: { get(): VoiceSettings; setKeepRunning(on: boolean): boolean };
  readonly docker: DockerRunner;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the server to answer after docker started it. Default 120 s. */
  readonly healthWaitMs?: number;
  /** First backoff after a failed attempt; doubles each time. Default 10 s. */
  readonly backoffBaseMs?: number;
  /** Timer period while enabled. Default 60 s. */
  readonly intervalMs?: number;
}

/** Why `ensure` ran. `manual` (Retry, enabling) ignores the backoff and the attempt cap. */
export type EnsureReason = "startup" | "timer" | "use" | "manual";

/** The supervisor. One per Cortex server. */
export interface SpeechSupervisor {
  status(): SpeechStatus;
  /** Bring the server up if it is down. Single-flight; resolves with the final status. A no-op while the opt-in is off. */
  ensure(reason: EnsureReason): Promise<SpeechStatus>;
  /** Save the opt-in, forget past failures, and (when on) start an `ensure`. `refusal` when it cannot be turned on. */
  setKeepRunning(enabled: boolean): { readonly ok: true; readonly status: SpeechStatus } | { readonly ok: false; readonly error: string };
  /** `ensure("manual")`. */
  retry(): Promise<SpeechStatus>;
  /** True when the opt-in is on and `direction`'s endpoint is the supervised one. */
  supervises(direction: "stt" | "tts"): boolean;
  /** Start a background check if enabled and the last one is old (cheap, for read-only calls). */
  touch(): void;
  /** Check now if enabled and run the timer. */
  start(): void;
  /** Stop the timer. */
  stop(): void;
}

const sleepReal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Build the supervisor. */
export function createSpeechSupervisor(deps: SpeechSupervisorDeps): SpeechSupervisor {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepReal;
  const healthWaitMs = deps.healthWaitMs ?? 120_000;
  const backoffBaseMs = deps.backoffBaseMs ?? 10_000;
  const intervalMs = deps.intervalMs ?? 60_000;
  const TOUCH_GAP_MS = 15_000;

  let phase: SpeechPhase = "checking";
  let message = "";
  let lastError: string | null = null;
  let attempts = 0;
  let nextAttemptAt = 0;
  let lastCheckAt = 0;
  let policyChecked = false;
  let inflight: Promise<SpeechStatus> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const keepRunning = (): boolean => deps.settings.get().localSpeech.keepRunning;

  function status(): SpeechStatus {
    const settings = deps.settings.get();
    const target = resolveSpeechTarget(settings);
    const on = settings.localSpeech.keepRunning;
    const shown: SpeechPhase = !on ? "disabled" : !target.ok ? "unavailable" : phase;
    return {
      phase: shown,
      keepRunning: on,
      eligible: target.ok,
      message: !on ? "Cortex is not managing the local speech server." : !target.ok ? target.reason : message,
      lastError: shown === "failed" ? lastError : null,
      attempts,
      locked: attempts >= MAX_ATTEMPTS,
      container: SPEECH_CONTAINER,
      endpoint: target.ok ? new URL(target.origin).host : null,
      models: target.ok ? target.models : [],
    };
  }

  const set = (p: SpeechPhase, m: string): void => {
    phase = p;
    message = m;
  };

  const timeoutSignal = (ms: number): AbortSignal => AbortSignal.timeout(ms);

  async function get2xx(url: string, ms = 4000): Promise<Response | null> {
    try {
      const res = await doFetch(url, { signal: timeoutSignal(ms), redirect: "manual" });
      if (res.ok) return res;
      await res.body?.cancel().catch(() => undefined);
      return null;
    } catch {
      return null;
    }
  }

  async function healthy(target: Extract<SpeechTarget, { ok: true }>): Promise<boolean> {
    const a = await get2xx(`${target.origin}/health`);
    if (a !== null) {
      await a.body?.cancel().catch(() => undefined);
      return true;
    }
    const b = await get2xx(`${target.apiBase}/models`);
    if (b !== null) {
      await b.body?.cancel().catch(() => undefined);
      return true;
    }
    return false;
  }

  async function waitHealthy(target: Extract<SpeechTarget, { ok: true }>): Promise<boolean> {
    const stepMs = 1000;
    for (let waited = 0; waited <= healthWaitMs; waited += stepMs) {
      if (await healthy(target)) return true;
      await sleep(stepMs);
    }
    return false;
  }

  interface Inspected {
    readonly running: boolean;
    readonly policy: string;
    readonly image: string;
    readonly bindings: string;
  }

  const INSPECT_FORMAT =
    "{{.State.Running}}|{{.HostConfig.RestartPolicy.Name}}|{{.Config.Image}}|{{range $p, $b := .HostConfig.PortBindings}}{{$p}}={{range $b}}{{.HostIp}}:{{.HostPort}},{{end}};{{end}}";

  /** `missing`, an `Inspected`, or a docker problem sentence. */
  async function inspect(): Promise<"missing" | Inspected | { readonly problem: string }> {
    const r = await deps.docker.run(["inspect", "--format", INSPECT_FORMAT, SPEECH_CONTAINER], 15_000);
    if (r.code !== 0) {
      if (r.spawnError === undefined && /no such (object|container)/i.test(r.stderr)) return "missing";
      return { problem: dockerProblem(r) };
    }
    const [running = "", policy = "", image = "", ...rest] = r.stdout.trim().split("|");
    return { running: running === "true", policy, image, bindings: rest.join("|") };
  }

  const ownImage = (image: string): boolean => image === SPEECH_IMAGES.cpu || image === SPEECH_IMAGES.cuda;
  const ownBinding = (bindings: string, port: number): boolean => bindings.includes(`${INNER_PORT}/tcp=127.0.0.1:${port},;`);

  async function ensurePolicy(i: Inspected): Promise<void> {
    if (i.policy === "unless-stopped" || i.policy === "always") return;
    // Best effort: the container is up either way.
    await deps.docker.run(["update", "--restart", "unless-stopped", SPEECH_CONTAINER], 15_000);
  }

  /** Start or create the container. Returns a problem sentence, or undefined when docker accepted the start. */
  async function bringUp(target: Extract<SpeechTarget, { ok: true }>): Promise<string | undefined> {
    const found = await inspect();
    if (typeof found === "object" && "problem" in found) return found.problem;
    if (found !== "missing") {
      if (!ownImage(found.image) || !ownBinding(found.bindings, target.port)) {
        return `A container named ${SPEECH_CONTAINER} already exists but is not the Cortex speech server (different image or port). Remove it with: docker rm -f ${SPEECH_CONTAINER}`;
      }
      if (!found.running) {
        const s = await deps.docker.run(["start", SPEECH_CONTAINER], 60_000);
        if (s.code !== 0) return dockerProblem(s);
      }
      await ensurePolicy(found);
      return undefined;
    }
    const info = await deps.docker.run(["info", "--format", "{{json .Runtimes}}"], 15_000);
    if (info.code !== 0 && info.spawnError !== undefined) return dockerProblem(info);
    const gpu = info.code === 0 && /"nvidia"/.test(info.stdout);
    const image = gpu ? SPEECH_IMAGES.cuda : SPEECH_IMAGES.cpu;
    const args = [
      "run",
      "--detach",
      "--name",
      SPEECH_CONTAINER,
      "--restart",
      "unless-stopped",
      "--publish",
      `127.0.0.1:${target.port}:${INNER_PORT}`,
      "--volume",
      `${SPEECH_CACHE_VOLUME}:${CACHE_MOUNT}`,
      ...(gpu ? ["--gpus", "all"] : []),
      image,
    ];
    // An image pull can take minutes.
    const run = await deps.docker.run(args, 15 * 60_000);
    return run.code === 0 ? undefined : dockerProblem(run);
  }

  async function installedModels(target: Extract<SpeechTarget, { ok: true }>): Promise<ReadonlySet<string> | null> {
    const res = await get2xx(`${target.apiBase}/models`, 15_000);
    if (res === null) return null;
    try {
      const body: unknown = await res.json();
      const data = typeof body === "object" && body !== null && "data" in body ? (body as { data: unknown }).data : [];
      const ids = Array.isArray(data) ? data.map((m) => (typeof m === "object" && m !== null && "id" in m ? (m as { id: unknown }).id : null)) : [];
      return new Set(ids.filter((id): id is string => typeof id === "string"));
    } catch {
      return null;
    }
  }

  /** Download what the server lacks. Returns a problem sentence, or undefined. */
  async function ensureModels(target: Extract<SpeechTarget, { ok: true }>): Promise<string | undefined> {
    const have = await installedModels(target);
    if (have === null) return "The speech server is up but did not list its models.";
    const missing = target.models.filter((m) => !have.has(m));
    for (const [i, model] of missing.entries()) {
      set("downloading", `Downloading model ${i + 1} of ${missing.length}: ${model}`);
      const url = `${target.apiBase}/models/${model.split("/").map(encodeURIComponent).join("/")}`;
      try {
        const res = await doFetch(url, { method: "POST", signal: timeoutSignal(15 * 60_000), redirect: "manual" });
        await res.body?.cancel().catch(() => undefined);
        if (!res.ok) return `Downloading ${model} failed (the speech server answered HTTP ${res.status}).`;
      } catch {
        return `Downloading ${model} failed (the speech server did not finish in time).`;
      }
    }
    return undefined;
  }

  function fail(problem: string): void {
    attempts += 1;
    lastError = scrubDockerText(problem);
    nextAttemptAt = now() + backoffBaseMs * 2 ** (attempts - 1);
    set("failed", attempts >= MAX_ATTEMPTS ? "The local speech server could not be started. Fix the problem, then press Retry." : "The local speech server is not ready yet; Cortex will try again shortly.");
  }

  async function run(target: Extract<SpeechTarget, { ok: true }>): Promise<SpeechStatus> {
    lastCheckAt = now();
    if (!(phase === "ready")) set("checking", "Checking the local speech server.");
    let up = await healthy(target);
    if (!up) {
      set("starting", "Starting the local speech server.");
      const problem = await bringUp(target);
      if (problem !== undefined) {
        fail(problem);
        return status();
      }
      up = await waitHealthy(target);
      if (!up) {
        fail("The speech server did not answer after its container started. First start can take a while (image download); press Retry to keep waiting.");
        return status();
      }
    } else if (!policyChecked) {
      policyChecked = true;
      const found = await inspect();
      if (typeof found === "object" && !("problem" in found) && ownImage(found.image)) await ensurePolicy(found);
    }
    const problem = await ensureModels(target);
    if (problem !== undefined) {
      fail(problem);
      return status();
    }
    attempts = 0;
    lastError = null;
    nextAttemptAt = 0;
    set("ready", "The local speech server is running.");
    return status();
  }

  function ensure(reason: EnsureReason): Promise<SpeechStatus> {
    if (inflight !== null) return inflight;
    if (!keepRunning()) return Promise.resolve(status());
    const target = resolveSpeechTarget(deps.settings.get());
    if (!target.ok) return Promise.resolve(status());
    if (reason !== "manual") {
      if (attempts >= MAX_ATTEMPTS) return Promise.resolve(status());
      if (phase === "failed" && now() < nextAttemptAt) return Promise.resolve(status());
    }
    const p = run(target).finally(() => {
      inflight = null;
    });
    inflight = p;
    return p;
  }

  function reset(): void {
    phase = "checking";
    message = "";
    lastError = null;
    attempts = 0;
    nextAttemptAt = 0;
    policyChecked = false;
  }

  return {
    status,
    ensure,
    setKeepRunning(enabled) {
      if (enabled && !resolveSpeechTarget(deps.settings.get()).ok) {
        return { ok: false, error: "Set the listening or reading engine to a local Speaches endpoint first (a localhost URL with a port, ending in /v1)." };
      }
      if (!deps.settings.setKeepRunning(enabled)) return { ok: false, error: "Could not save the setting." };
      reset();
      if (enabled) void ensure("manual");
      return { ok: true, status: status() };
    },
    retry: () => {
      attempts = 0;
      nextAttemptAt = 0;
      return ensure("manual");
    },
    supervises(direction) {
      if (!keepRunning()) return false;
      const t = resolveSpeechTarget(deps.settings.get());
      return t.ok && t.directions.includes(direction);
    },
    touch() {
      if (keepRunning() && now() - lastCheckAt >= TOUCH_GAP_MS) void ensure("use");
    },
    start() {
      if (timer !== null) return;
      if (keepRunning()) void ensure("startup");
      timer = setInterval(() => void ensure("timer"), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
