import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/** A tool returned an error result: a guard refusal or a failure. */
export class ToolError extends Error {
  override name = "ToolError";
}

export type ToolClient = {
  /** Calls one tool and returns its JSON result. Throws `ToolError` on an error result. */
  // biome-ignore lint/suspicious/noExplicitAny: tool results are JSON of many shapes
  call: <T = any>(tool: string, args: Record<string, unknown>) => Promise<T>;
};

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((b: { type?: string; text?: string }) => (b.type === "text" ? (b.text ?? "") : ""))
    .join("");
}

/**
 * A lazy MCP client for code that calls another server (for example orders → catalogue).
 * It connects on the first call and once more after a failure.
 */
export function connectTool(url: string, clientName: string): ToolClient {
  let client: Client | undefined;

  async function open(): Promise<Client> {
    if (client) return client;
    const c = new Client({ name: clientName, version: "0.1.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(url)));
    client = c;
    return c;
  }

  async function once(tool: string, args: Record<string, unknown>) {
    const c = await open();
    return c.callTool({ name: tool, arguments: args });
  }

  return {
    async call(tool, args) {
      let result: Awaited<ReturnType<typeof once>>;
      try {
        result = await once(tool, args);
      } catch {
        client = undefined;
        result = await once(tool, args);
      }
      const text = textOf(result.content);
      if (result.isError) throw new ToolError(`${tool}: ${text}`);
      return text ? JSON.parse(text) : null;
    },
  };
}
