import assert from "node:assert/strict";
import { test } from "node:test";
import { log } from "@ac/log";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { createApp, defineTool, GuardError, registerMcp } from "./index.ts";

test("a client lists the tool, the guard refuses, run returns JSON", async () => {
  const seen: number[] = [];
  const tool = defineTool({
    name: "add",
    description: "adds",
    input: z.object({ n: z.number().int() }),
    guard: ({ n }) => {
      if (n < 0) throw new GuardError("n must not be negative");
    },
    run: async ({ n }) => {
      seen.push(n);
      return { total: seen.reduce((a, b) => a + b, 0) };
    },
  });
  const app = createApp();
  registerMcp(app, { name: "test", tools: [tool], log: log("mcp-test") });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ["add"],
    );
    const schema = tools[0]?.inputSchema as { properties?: object } | undefined;
    assert.ok(schema?.properties);

    const ok = await client.callTool({ name: "add", arguments: { n: 2 } });
    assert.equal(ok.isError ?? false, false);
    assert.deepEqual(JSON.parse((ok.content as { text: string }[])[0]?.text ?? ""), { total: 2 });

    const refused = await client.callTool({ name: "add", arguments: { n: -1 } });
    assert.equal(refused.isError, true);
    assert.match(
      (refused.content as { text: string }[])[0]?.text ?? "",
      /Refused: n must not be negative/,
    );
    assert.deepEqual(seen, [2]);
  } finally {
    await client.close();
    await app.close();
  }
});
