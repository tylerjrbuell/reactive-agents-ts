import { createRequire } from "node:module";
import { isBun } from "./detect.js";
import type { ServeOptions, ServerLike } from "./types.js";

const require = createRequire(import.meta.url);

interface BunServeApi {
  serve(opts: ServeOptions): {
    port: number;
    hostname: string;
    url: URL;
    stop(closeActive?: boolean): void;
  };
}

function serveBun(options: ServeOptions): ServerLike {
  const Bun = (globalThis as { Bun?: BunServeApi }).Bun;
  if (!Bun) throw new Error("serveBun called when Bun runtime not present");
  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname,
    fetch: options.fetch,
  });
  return {
    port: server.port,
    hostname: server.hostname,
    url: server.url,
    stop: (closeActive?: boolean) => server.stop(closeActive),
  };
}

function serveNode(options: ServeOptions): Promise<ServerLike> {
  const { createServer } = require("node:http") as typeof import("node:http");

  const server = createServer(async (req, res) => {
    try {
      const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const requestInit: RequestInit & { duplex?: "half" } = {
        method: req.method ?? "GET",
        headers,
        body: hasBody
          ? new ReadableStream({
              start(controller) {
                req.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
                req.on("end", () => controller.close());
                req.on("error", (err) => controller.error(err));
              },
            })
          : null,
      };
      if (hasBody) requestInit.duplex = "half";
      const request = new Request(url, requestInit as RequestInit);

      const response = await options.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });

  return new Promise<ServerLike>((resolve) => {
    server.listen({ port: options.port ?? 0, host: options.hostname ?? "127.0.0.1" }, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const hostname = options.hostname ?? "127.0.0.1";
      resolve({
        port,
        hostname,
        url: new URL(`http://${hostname}:${port}/`),
        stop: (_closeActive?: boolean) => { server.close(); },
      });
    });
  });
}

/**
 * Cross-runtime HTTP server.
 * Returns Promise<ServerLike> — callers must `await serve(...)`.
 * Bun.serve is sync but Promise.resolve of sync value works.
 */
export function serve(options: ServeOptions): Promise<ServerLike> {
  if (isBun) return Promise.resolve(serveBun(options));
  return serveNode(options);
}
