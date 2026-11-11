import { type Pool, query } from "@ac/db";
import { defineTool, GuardError, type ToolClient } from "@ac/mcp-kit";
import { z } from "zod";
import { FEES, geocode, NO_COURIER_SKUS } from "./rules.ts";

type DraftView = {
  draft_id: string;
  state: string;
  address: { line1: string; city: string; postcode: string };
  offer: {
    version: number;
    status: string;
    shipping_fee: number;
    items: { sku: string; quantity: number }[];
  } | null;
};

const DraftId = z.object({ draft_id: z.string().min(1) });

export async function latestQuote(pool: Pool, draftId: string) {
  const r = await query<{ quote_id: string; fee: number; zone: string; created_at: string }>(
    pool,
    "SELECT quote_id, fee, zone, created_at FROM quotes WHERE draft_id = $1 ORDER BY created_at DESC LIMIT 1",
    [draftId],
  );
  return r.rows[0] ?? null;
}

/** Shipping tools (design §6). The draft address and the agreed fee come from the orders server (G3). */
export function shippingTools(pool: Pool, orders: ToolClient, payment: ToolClient) {
  const draftOf = (draft_id: string) => orders.call<DraftView>("get_draft", { draft_id });

  const geocodeTool = defineTool({
    name: "geocode",
    description:
      "Checks the agreed delivery address of the draft. Returns resolved true or false, and the zone.",
    input: DraftId,
    run: async ({ draft_id }) => {
      const draft = await draftOf(draft_id);
      return { draft_id, address: draft.address, ...geocode(draft.address) };
    },
  });

  const quote = defineTool({
    name: "quote",
    description:
      "Quotes the delivery fee for the draft address (cents). Returns quote_id, fee, the agreed_fee in the approved offer, and matches (true when they are equal).",
    input: DraftId,
    run: async ({ draft_id }) => {
      const draft = await draftOf(draft_id);
      const geo = geocode(draft.address);
      if (!geo.resolved)
        throw new GuardError(
          "the address does not resolve; call geocode and report address_unresolved",
        );
      const quote_id = crypto.randomUUID();
      const fee = FEES[geo.zone];
      await query(
        pool,
        "INSERT INTO quotes (quote_id, draft_id, postcode, zone, fee) VALUES ($1, $2, $3, $4, $5)",
        [quote_id, draft_id, draft.address.postcode, geo.zone, fee],
      );
      const agreed = draft.offer?.shipping_fee ?? null;
      return { quote_id, fee, zone: geo.zone, agreed_fee: agreed, matches: agreed === fee };
    },
  });

  const book = defineTool({
    name: "book",
    description:
      "Books the courier for the draft. Allowed only when the latest quote equals the agreed fee and the payment is authorized. Returns booked true with a tracking_id, or booked false with reason courier_unavailable.",
    input: DraftId,
    guard: async ({ draft_id }) => {
      const draft = await draftOf(draft_id);
      const q = await latestQuote(pool, draft_id);
      if (!q) throw new GuardError("no quote for this draft; call quote first");
      if (draft.offer?.shipping_fee !== q.fee) {
        throw new GuardError(
          `quote ${q.fee} does not match the agreed fee ${draft.offer?.shipping_fee}`,
        );
      }
      const auth = await payment.call<{ status: string } | null>("get_authorization", { draft_id });
      if (auth?.status !== "authorized") throw new GuardError("the payment is not authorized");
    },
    run: async ({ draft_id }) => {
      const draft = await draftOf(draft_id);
      const blocked = draft.offer?.items.filter((i) => NO_COURIER_SKUS.includes(i.sku)) ?? [];
      if (blocked.length > 0) {
        return {
          booked: false,
          reason: "courier_unavailable",
          detail: `no courier takes: ${blocked.map((i) => i.sku).join(", ")}`,
        };
      }
      const q = await latestQuote(pool, draft_id);
      const tracking_id = `TRK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await query(
        pool,
        "INSERT INTO bookings (tracking_id, draft_id, quote_id, status) VALUES ($1, $2, $3, 'booked')",
        [tracking_id, draft_id, q?.quote_id],
      );
      return { booked: true, tracking_id };
    },
  });

  const getQuote = defineTool({
    name: "get_quote",
    description:
      "Returns the latest quote of a draft, or null. Read only. Used by the orders server for the fee in a new offer.",
    input: DraftId,
    run: async ({ draft_id }) => latestQuote(pool, draft_id),
  });

  const getBooking = defineTool({
    name: "get_booking",
    description:
      "Returns the latest booking of a draft (tracking_id, status), or null. Read only. Used by the payment server.",
    input: DraftId,
    run: async ({ draft_id }) => {
      const r = await query(
        pool,
        "SELECT tracking_id, status, created_at FROM bookings WHERE draft_id = $1 ORDER BY created_at DESC LIMIT 1",
        [draft_id],
      );
      return r.rows[0] ?? null;
    },
  });

  return [geocodeTool, quote, book, getQuote, getBooking];
}
