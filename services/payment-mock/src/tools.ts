import { type Pool, query } from "@ac/db";
import { defineTool, GuardError, type ToolClient } from "@ac/mcp-kit";
import { z } from "zod";
import { bank } from "./rules.ts";

type DraftView = {
  draft_id: string;
  customer_id: string;
  state: string;
  offer: { version: number; status: string; total: number } | null;
};
type Auth = {
  authorization_id: string;
  status: string;
  amount: number;
  offer_version: number;
  capture_id: string | null;
};

const DraftId = z.object({ draft_id: z.string().min(1) });
const MAX_UNKNOWN_QUERIES = 3;

async function latest(pool: Pool, draftId: string): Promise<Auth | null> {
  const r = await query<Auth>(
    pool,
    `SELECT authorization_id, status, amount, offer_version, capture_id FROM authorizations
      WHERE draft_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [draftId],
  );
  return r.rows[0] ?? null;
}

/** Payment tools (design §6). The agent never passes an amount: it is the approved offer total. */
export function paymentTools(
  pool: Pool,
  orders: ToolClient,
  customers: ToolClient,
  shipping: ToolClient,
) {
  const authorize = defineTool({
    name: "authorize",
    description:
      "Authorizes the approved offer total of the draft on the customer's card. Returns result approved (with authorization_id), declined or unknown. On unknown the tool already queried the bank 3 times.",
    input: DraftId,
    run: async ({ draft_id }) => {
      const draft = await orders.call<DraftView>("get_draft", { draft_id });
      if (draft.state !== "confirmed" || draft.offer?.status !== "approved") {
        throw new GuardError(
          `no approved offer: draft is ${draft.state}, offer is ${draft.offer?.status ?? "none"}`,
        );
      }
      const current = await latest(pool, draft_id);
      if (current?.status === "authorized" && current.offer_version === draft.offer.version) {
        return {
          result: "approved",
          authorization_id: current.authorization_id,
          amount: current.amount,
          note: "already authorized",
        };
      }
      const { card_ref } = await customers.call<{ card_ref: string }>("get_customer", {
        customer_id: draft.customer_id,
      });
      let result = bank(card_ref);
      let attempts = 1;
      while (result === "unknown" && attempts < MAX_UNKNOWN_QUERIES) {
        attempts += 1;
        result = bank(card_ref);
      }
      const authorization_id = crypto.randomUUID();
      const status = result === "approved" ? "authorized" : result;
      await query(
        pool,
        `INSERT INTO authorizations (authorization_id, draft_id, offer_version, amount, card_ref, status, attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          authorization_id,
          draft_id,
          draft.offer.version,
          draft.offer.total,
          card_ref,
          status,
          attempts,
        ],
      );
      return {
        result,
        authorization_id: result === "approved" ? authorization_id : null,
        amount: draft.offer.total,
        attempts,
      };
    },
  });

  const capture = defineTool({
    name: "capture",
    description:
      "Captures the authorized amount. Allowed only after the parcel is dispatched. Returns capture_id.",
    input: DraftId,
    guard: async ({ draft_id }) => {
      const auth = await latest(pool, draft_id);
      if (auth?.status !== "authorized")
        throw new GuardError(`no authorized payment (status ${auth?.status ?? "none"})`);
      const booking = await shipping.call<{ status: string } | null>("get_booking", { draft_id });
      if (booking?.status !== "dispatched" && booking?.status !== "delivered") {
        throw new GuardError(
          `capture only after dispatch; the shipment is ${booking?.status ?? "not booked"}`,
        );
      }
    },
    run: async ({ draft_id }) => {
      const auth = await latest(pool, draft_id);
      const capture_id = `CAP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await query(
        pool,
        "UPDATE authorizations SET status = 'captured', capture_id = $2, updated_at = now() WHERE authorization_id = $1",
        [auth?.authorization_id, capture_id],
      );
      return { capture_id, amount: auth?.amount };
    },
  });

  const voidTool = defineTool({
    name: "void",
    description:
      "Voids an authorized payment of the draft. Safe to call when nothing is authorized: it returns voided false.",
    input: DraftId,
    run: async ({ draft_id }) => {
      const auth = await latest(pool, draft_id);
      if (auth?.status !== "authorized") return { voided: false, status: auth?.status ?? "none" };
      await query(
        pool,
        "UPDATE authorizations SET status = 'voided', updated_at = now() WHERE authorization_id = $1",
        [auth.authorization_id],
      );
      return { voided: true, authorization_id: auth.authorization_id };
    },
  });

  const getAuthorization = defineTool({
    name: "get_authorization",
    description:
      "Returns the latest authorization of a draft (status, amount), or null. Read only. Used by the shipping server.",
    input: DraftId,
    run: async ({ draft_id }) => latest(pool, draft_id),
  });

  return [authorize, capture, voidTool, getAuthorization];
}
