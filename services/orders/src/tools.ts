import { query, withTransaction } from "@ac/db";
import { defineTool, GuardError, ToolError } from "@ac/mcp-kit";
import { z } from "zod";
import { config } from "./config.ts";
import { assertDraftId, createOffer, type Deps, draftView, history, lockDraft } from "./drafts.ts";

const cents = z.number().int().nonnegative();
const Item = z.object({ sku: z.string().min(1), quantity: z.number().int().positive() });

type Customer = {
  customer_id: string;
  default_address: { line1: string; city: string; postcode: string } | null;
};
type Product = { sku: string; name: string; unit_price: number; available: number };

/** The orders tools (design §6, G3). The guard runs here, not in the agent (design rule 8). */
export function ordersTools(deps: Deps) {
  const { pool, catalogue, customers } = deps;

  const createDraftOrder = defineTool({
    name: "create_draft_order",
    description:
      "Creates a draft order for one SKU, a quantity and an optional maximum unit price (cents). Copies the customer's default address. If the SKU is in stock within the price, offer version 1 is made at once (state offered) and the customer gets an email. Else the state is waiting: then call register_watch.",
    input: z.object({
      customer_id: z.string().min(1),
      sku: z.string().min(1).describe("a SKU from search_products"),
      quantity: z.number().int().positive().max(20),
      max_price: cents
        .nullable()
        .optional()
        .describe("maximum price per unit in cents, if the customer said one"),
    }),
    run: async ({ customer_id, sku, quantity, max_price }, ctx) => {
      let customer: Customer;
      try {
        customer = await customers.call<Customer>("get_customer", { customer_id });
      } catch (error) {
        if (error instanceof ToolError) throw new GuardError(`unknown customer ${customer_id}`);
        throw error;
      }
      if (!customer.default_address)
        throw new GuardError(`customer ${customer_id} has no default address`);
      const [product] = await catalogue.call<Product[]>("get_products", { skus: [sku] });
      if (!product) throw new GuardError(`unknown SKU ${sku}; use search_products`);

      const draft_id = crypto.randomUUID();
      await withTransaction(pool, async (tx) => {
        await query(
          tx,
          `INSERT INTO drafts (draft_id, customer_id, sku, quantity, max_price, state, address)
           VALUES ($1, $2, $3, $4, $5, 'waiting', $6)`,
          [
            draft_id,
            customer_id,
            sku,
            quantity,
            max_price ?? null,
            JSON.stringify(customer.default_address),
          ],
        );
        await history(tx, draft_id, `created: ${quantity} x ${sku}`, {
          decision_id: ctx.decision_id,
        });
      });

      const fits = max_price == null || product.unit_price <= max_price;
      if (product.available >= quantity && fits) {
        const result = await createOffer(deps, draft_id, [{ sku, quantity }], ctx.decision_id);
        return {
          draft_id,
          state: "offered",
          ...result,
          next: "The offer email goes to the customer. Tell the customer to check the inbox.",
        };
      }
      return {
        draft_id,
        state: "waiting",
        available: product.available,
        unit_price: product.unit_price,
        next: fits
          ? "Out of stock. Call register_watch for this draft."
          : "Price above the maximum. Call register_watch for this draft.",
      };
    },
  });

  const registerWatch = defineTool({
    name: "register_watch",
    description:
      "Watches a SKU for a waiting draft. The Gate matches the watch when stock arrives at or under max_price (cents per unit). One open watch per draft.",
    input: z.object({
      draft_id: z.string().min(1),
      sku: z.string().min(1),
      quantity: z.number().int().positive(),
      max_price: cents.nullable().optional(),
    }),
    run: async ({ draft_id, sku, quantity, max_price }, ctx) => {
      assertDraftId(draft_id);
      return withTransaction(pool, async (tx) => {
        const draft = await lockDraft(tx, draft_id);
        if (!draft) throw new GuardError(`unknown draft ${draft_id}`);
        if (draft.state !== "waiting") throw new GuardError(`draft is ${draft.state}, not waiting`);
        const open = await query(
          tx,
          "SELECT 1 FROM stock_watches WHERE draft_id = $1 AND status = 'open'",
          [draft_id],
        );
        if (open.rowCount) throw new GuardError("the draft already has an open watch");
        const watch_id = crypto.randomUUID();
        const limit = max_price ?? draft.max_price;
        const r = await query<{ expires_at: string }>(
          tx,
          `INSERT INTO stock_watches (watch_id, draft_id, sku, quantity, max_price, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'open', now() + make_interval(mins => $6)) RETURNING expires_at`,
          [watch_id, draft_id, sku, quantity, limit, config.watchTtlMinutes],
        );
        await history(tx, draft_id, `watch on ${sku}`, { decision_id: ctx.decision_id });
        return {
          watch_id,
          draft_id,
          sku,
          quantity,
          max_price: limit,
          expires_at: r.rows[0]?.expires_at,
        };
      });
    },
  });

  const proposeOffer = defineTool({
    name: "propose_offer",
    description:
      "Makes the next offer version for a draft from a list of SKUs and quantities. Code sets every price and the shipping fee. Max 3 versions: a 4th call cancels the draft. Allowed when the draft is waiting, or confirmed after shipment.failed.",
    input: z.object({ draft_id: z.string().min(1), items: z.array(Item).min(1).max(5) }),
    guard: async ({ draft_id }) => {
      assertDraftId(draft_id);
      const r = await query<{ state: string }>(
        pool,
        "SELECT state FROM drafts WHERE draft_id = $1",
        [draft_id],
      );
      const state = r.rows[0]?.state;
      if (!state) throw new GuardError(`unknown draft ${draft_id}`);
      if (state !== "waiting" && state !== "confirmed") {
        throw new GuardError(
          `draft is ${state}; an offer is possible only when waiting or confirmed`,
        );
      }
    },
    run: async ({ draft_id, items }, ctx) => createOffer(deps, draft_id, items, ctx.decision_id),
  });

  const getDraft = defineTool({
    name: "get_draft",
    description:
      "Returns a draft: customer, requested SKU and quantity, state, delivery and payment status, the agreed address, the current offer (items, fee, total) and the stock watch. Read only.",
    input: z.object({ draft_id: z.string().min(1) }),
    run: async ({ draft_id }) => {
      assertDraftId(draft_id);
      const view = await draftView(pool, draft_id);
      if (!view) throw new GuardError(`unknown draft ${draft_id}`);
      return view;
    },
  });

  return [createDraftOrder, registerWatch, proposeOffer, getDraft];
}
