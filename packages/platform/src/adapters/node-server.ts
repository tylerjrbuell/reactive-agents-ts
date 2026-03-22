/**
 * Node.js server adapter — wraps node:http behind ServerAdapter.
 * Converts IncomingMessage ↔ Fetch Request/Response at the boundary.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { ServerAdapter, ServerHandle } from "../types.js";

function nodeReqToRequest(
  req: IncomingMessage,
  hostname: string,
  port: number,
): Request {
  const url = `http://${hostname}:${port}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  let body: ReadableStream | null = null;
  if (hasBody) {
    body = new ReadableStream({
      start(controller) {
        req.on("data", (chunk: Buffer) =>
          controller.enqueue(new Uint8Array(chunk)),
        );
        req.on("end", () => controller.close());
        req.on("error", (err) => controller.error(err));
      },
    });
  }

  return new Request(url, {
    method,
    headers,
    body,
    ...(hasBody ? ({ duplex: "half" } as any) : {}),
  });
}

async function sendResponse(
  fetchResponse: Response,
  res: ServerResponse,
): Promise<void> {
  const headerObj: Record<string, string> = {};
  fetchResponse.headers.forEach((value, key) => {
    headerObj[key] = value;
  });
  res.writeHead(fetchResponse.status, headerObj);

  if (fetchResponse.body) {
    const reader = fetchResponse.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  res.end();
}

export function createNodeServer(): ServerAdapter {
  return {
    serve(options): Promise<ServerHandle> {
      return new Promise<ServerHandle>((resolve) => {
        const hostname = options.hostname ?? "0.0.0.0";

        const server = createServer(
          async (req: IncomingMessage, res: ServerResponse) => {
            try {
              const request = nodeReqToRequest(req, hostname, options.port);
              const response = await options.fetch(request);
              await sendResponse(response, res);
            } catch {
              res.writeHead(500);
              res.end("Internal Server Error");
            }
          },
        );

        server.listen(options.port, hostname, () => {
          const addr = server.address();
          const actualPort =
            typeof addr === "object" && addr !== null
              ? addr.port
              : options.port;

          resolve({
            get port() {
              return actualPort;
            },
            get hostname() {
              return hostname;
            },
            stop(): Promise<void> {
              return new Promise<void>((r) => server.close(() => r()));
            },
          } satisfies ServerHandle);
        });
      });
    },
  };
}
