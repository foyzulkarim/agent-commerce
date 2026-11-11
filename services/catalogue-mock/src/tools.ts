import { type Pool, query, withTransaction } from "@ac/db";
import { defineTool, GuardError } from "@ac/mcp-kit";
import { z } from "zod";
import { getProducts, searchProducts } from "./catalogue.ts";

const Item = z.object({ sku: z.string().min(1), quantity: z.number().int().positive() });

/** Catalogue tools (design §6 and G1). Prices are minor units (cents), AUD. */
export function catalogueTools(pool: Pool) {
  const search = defineTool({
    name: "search_products",
    description:
      "Searches the catalogue. Every word must match the SKU, name or description; an empty query lists all products. Returns sku, name, description, unit_price (cents, AUD) and available units. Read only.",
    input: z.object({ query: z.string().describe("for example 'coffee beans' or 'kettle'") }),
    run: async ({ query: text }) => {
      const products = await searchProducts(pool, text);
      return products.map(({ sku, name, description, unit_price, available }) => ({
        sku,
        name,
        description,
        unit_price,
        available,
      }));
    },
  });

  const get = defineTool({
    name: "get_products",
    description:
      "Returns price and available units for the given SKUs. Read only. Used by the orders server.",
    input: z.object({ skus: z.array(z.string().min(1)).min(1) }),
    run: async ({ skus }) => getProducts(pool, skus),
  });

  const reserve = defineTool({
    name: "reserve_stock",
    description:
      "Reserves stock for the approved offer of a draft. Replaces the reservation of an older offer version of the same draft. Called by the orders Response endpoints (code), never by an agent.",
    input: z.object({
      draft_id: z.string().min(1),
      offer_version: z.number().int().positive(),
      items: z.array(Item).min(1),
    }),
    guard: async ({ draft_id, offer_version }) => {
      const newer = await query(
        pool,
        "SELECT 1 FROM reservations WHERE draft_id = $1 AND offer_version > $2 LIMIT 1",
        [draft_id, offer_version],
      );
      if (newer.rowCount) throw new GuardError("a newer offer version already holds the stock");
    },
    run: async ({ draft_id, offer_version, items }) =>
      withTransaction(pool, async (tx) => {
        // Lock the stock rows so two approvals cannot take the same last unit.
        await query(tx, "SELECT sku FROM stock WHERE sku = ANY($1) FOR UPDATE", [
          items.map((i) => i.sku),
        ]);
        await query(tx, "DELETE FROM reservations WHERE draft_id = $1", [draft_id]);
        const products = await getProducts(
          tx,
          items.map((i) => i.sku),
        );
        for (const item of items) {
          const product = products.find((p) => p.sku === item.sku);
          if (!product) throw new GuardError(`unknown SKU ${item.sku}`);
          if (product.available < item.quantity) {
            throw new GuardError(
              `sold out: ${item.sku} has ${product.available}, needs ${item.quantity}`,
            );
          }
        }
        for (const item of items) {
          await query(
            tx,
            "INSERT INTO reservations (draft_id, offer_version, sku, quantity) VALUES ($1, $2, $3, $4)",
            [draft_id, offer_version, item.sku, item.quantity],
          );
        }
        return { reserved: true, draft_id, offer_version, items };
      }),
  });

  return [search, get, reserve];
}
