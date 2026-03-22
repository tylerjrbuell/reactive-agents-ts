import type { ServerAdapter, ServerHandle } from "../types.js";

export function createBunServer(): ServerAdapter {
  return {
    async serve(options: {
      port: number;
      hostname?: string;
      fetch: (request: Request) => Response | Promise<Response>;
    }): Promise<ServerHandle> {
      const server = Bun.serve({
        port: options.port,
        hostname: options.hostname,
        fetch: options.fetch,
      });

      return {
        get port(): number {
          return server.port;
        },
        get hostname(): string {
          return server.hostname;
        },
        stop(): Promise<void> {
          server.stop();
          return Promise.resolve();
        },
      };
    },
  };
}
