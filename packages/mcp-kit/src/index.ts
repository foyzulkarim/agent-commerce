import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Logger } from "@ac/log";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

export { connectTool, type ToolClient, ToolError } from "./client.ts";
export { createApp, escapeHtml, htmlPage, wantsHtml } from "./http.ts";

/** Thrown by a guard. The tool returns it to the caller as an error result; `run` does not start. */
export class GuardError extends Error {
  override name = "GuardError";
}

/** Who called the tool. `decision_id` is set when an agent turn made the call (header `x-decision-id`). */
export type CallContext = { decision_id: string | null };

export type ToolDef<I extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: I;
  /** Checks the input before `run`. Throw `GuardError` to refuse. Read-only tools have no guard. */
  guard?: (input: z.infer<I>, ctx: CallContext) => Promise<void> | void;
  run: (input: z.infer<I>, ctx: CallContext) => Promise<unknown>;
};

/** The one way to declare a tool. The guard runs in the server, never in the agent (design rule 8). */
export function defineTool<I extends z.ZodObject>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

export const DECISION_HEADER = "x-decision-id";

const result = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
});

export type ServeOptions = {
  name: string;
  version?: string;
  // biome-ignore lint/suspicious/noExplicitAny: a list of tools with different input schemas
  tools: ToolDef<any>[];
  log: Logger;
};

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
    (request) => {
      const ctx: CallContext = {
        decision_id: request.requestInfo?.headers.get(DECISION_HEADER) || null,
      };
      const server = new McpServer({ name, version });
      for (const tool of tools) {
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.input },
          async (args: unknown) => {
            const parsed = tool.input.safeParse(args);
            if (!parsed.success) {
              return result(`Bad input: ${parsed.error.message}`, true);
            }
            const input = parsed.data;
            try {
              await tool.guard?.(input, ctx);
              const output = await tool.run(input, ctx);
              log.info({ tool: tool.name, input, decision_id: ctx.decision_id }, "tool ran");
              return result(JSON.stringify(output ?? null));
            } catch (error) {
              if (error instanceof GuardError) {
                log.warn({ tool: tool.name, input, reason: error.message }, "guard refused");
                return result(`Refused: ${error.message}`, true);
              }
              log.error({ err: error, tool: tool.name, input }, "tool failed");
              return result(`Failed: ${(error as Error).message}`, true);
            }
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
