import { randomUUID } from "node:crypto";
import { type Pool, query } from "@ac/db";
import { defineTool, GuardError } from "@ac/mcp-kit";
import { z } from "zod";

/** The orders tools (design §6). Phase 1 has the stub of `create_draft_order`. */
export function ordersTools(pool: Pool) {
  const createDraftOrder = defineTool({
    name: "create_draft_order",
    description:
      "Creates a draft order for one SKU and quantity. Prices come from the catalogue, never from the caller. Returns the draft id and its state.",
    input: z.object({
      customer_id: z.string().min(1).describe("The customer the draft belongs to"),
      sku: z.string().min(1),
      quantity: z.number().int().positive(),
    }),
    guard: ({ quantity }) => {
      if (quantity > 100) throw new GuardError("quantity above 100 needs a sales contact");
    },
    run: async ({ customer_id, sku, quantity }) => {
      const draft_id = randomUUID();
      await query(
        pool,
        "INSERT INTO drafts (draft_id, customer_id, sku, quantity, state) VALUES ($1, $2, $3, $4, 'waiting')",
        [draft_id, customer_id, sku, quantity],
      );
      return { draft_id, state: "waiting" };
    },
  });

  return [createDraftOrder];
}
