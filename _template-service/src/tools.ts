import { type Pool, query } from "@ac/db";
import { defineTool, GuardError } from "@ac/mcp-kit";
import { z } from "zod";

/** The MCP tools of __NAME__. A guard runs in the server; the agent only asks. */
export function __CAMEL__Tools(pool: Pool) {
  const countSeen = defineTool({
    name: "__NAME___count_seen",
    description: "Returns how many events __NAME__ has seen. Read only; no guard.",
    input: z.object({}),
    run: async () => {
      const result = await query<{ n: string }>(pool, "SELECT count(*)::text AS n FROM __NAME___events_seen");
      return { seen: Number(result.rows[0]?.n ?? 0) };
    },
  });

  const example = defineTool({
    name: "__NAME___example",
    description: "An example of a guarded tool. Replace it.",
    input: z.object({ amount: z.number().int().nonnegative() }),
    guard: ({ amount }) => {
      if (amount > 1000) throw new GuardError("amount above 1000 is not allowed");
    },
    run: async ({ amount }) => ({ accepted: amount }),
  });

  return [countSeen, example];
}
