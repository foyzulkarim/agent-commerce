import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Logger } from "@ac/log";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { z } from "zod";

/** Thrown by a guard. The tool returns it to the agent as an error result; nothing runs. */
export class GuardError extends Error {
  override name = "GuardError";
}

export type ToolDef<I extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: I;
  /** Checks the input before `run`. Throw `GuardError` to refuse. Read-only tools have no guard. */
  guard?: (input: z.infer<I>) => Promise<void> | void;
  run: (input: z.infer<I>) => Promise<unknown>;
};

/** The one way to declare a tool. The guard runs in the server, never in the agent (design rule 8). */
export function defineTool<I extends z.ZodObject>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

export type ServeOptions = {
  name: string;
  version?: string;
  tools: ToolDef[];
  log: Logger;
};

/** A Fastify app without its own logger. Services log through `@ac/log`. */
export function createApp(): FastifyInstance {
  return fastify({ logger: false });
}

function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const url = `http://${request.headers.host ?? "localhost"}${request.url}`;
  const body = request.method === "POST" ? (request.body as string) : undefined;
  return new Request(url, { method: request.method, headers, body });
}

/**
 * Mounts the tools on `POST /mcp` (Streamable HTTP, stateless; landscape #7).
 * One McpServer per request: the SDK's stateless idiom, nothing to clean up.
 */
export function registerMcp(app: FastifyInstance, options: ServeOptions): void {
  const { name, version = "0.1.0", tools, log } = options;
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name, version });
      for (const tool of tools) {
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.input },
          async (args: unknown) => {
            const input = tool.input.parse(args);
            try {
              await tool.guard?.(input);
            } catch (error) {
              if (error instanceof GuardError) {
                log.warn({ tool: tool.name, input, reason: error.message }, "guard refused");
                return {
                  isError: true,
                  content: [{ type: "text", text: `Refused: ${error.message}` }],
                };
              }
              throw error;
            }
            const result = await tool.run(input);
            log.info({ tool: tool.name, input }, "tool ran");
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
          },
        );
      }
      return server;
    },
    { onerror: (error) => log.error({ err: error }, "mcp error") },
  );

  app.register(async (scope) => {
    // Keep the JSON body as a string: the MCP handler parses it itself.
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) =>
      done(null, body),
    );
    scope.route({
      method: ["POST", "GET", "DELETE"],
      url: "/mcp",
      handler: async (request, reply) => {
        const response = await handler.fetch(toWebRequest(request));
        reply.status(response.status);
        response.headers.forEach((value, key) => {
          reply.header(key, value);
        });
        return reply.send(
          response.body ? Readable.fromWeb(response.body as WebReadableStream) : null,
        );
      },
    });
  });
}

export type { FastifyInstance };
