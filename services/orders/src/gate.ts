import { query, withTransaction } from "@ac/db";
import { type Envelope, newEvent } from "@ac/events";
import type { Deps } from "./drafts.ts";
import { history, writeOutbox } from "./drafts.ts";

type Watch = { watch_id: string; draft_id: string; quantity: number; max_price: number | null };

/**
 * The Gate (plain code): matches open watches on a restock or a price change (design §4 step 2, §10 item 13).
 * A watch matches when the SKU has stock and the price is at or under the watch's max_price.
 * Partial stock also matches: the Offer agent can ask the Inventory agent for a composition.
 */
export function gateHandler(deps: Deps) {
  return async (event: Envelope): Promise<void> => {
    if (event.type !== "stock.restocked" && event.type !== "price.changed") return;
    const sku = event.payload.sku;
    const price = event.type === "stock.restocked" ? event.payload.price : event.payload.new_price;
    const available = event.payload.available_qty;

    await withTransaction(deps.pool, async (tx) => {
      const watches = await query<Watch>(
        tx,
        `SELECT watch_id, draft_id, quantity, max_price FROM stock_watches
          WHERE sku = $1 AND status = 'open' AND expires_at > now()
          ORDER BY created_at FOR UPDATE SKIP LOCKED`,
        [sku],
      );
      let remaining = available;
      let matched = 0;
      for (const w of watches.rows) {
        if (remaining <= 0) break;
        if (w.max_price !== null && price > w.max_price) continue;
        await query(tx, "UPDATE stock_watches SET status = 'matched' WHERE watch_id = $1", [
          w.watch_id,
        ]);
        await writeOutbox(
          tx,
          newEvent({
            type: "watch.matched",
            payload: { watch_id: w.watch_id, sku, available_qty: remaining, price },
            draft_id: w.draft_id,
          }),
        );
        await history(tx, w.draft_id, `watch matched: ${remaining} x ${sku} at ${price}`, {
          event_type: event.type,
        });
        remaining -= Math.min(w.quantity, remaining);
        matched += 1;
      }
      if (matched === 0) {
        const reason =
          watches.rowCount === 0
            ? "no_open_watch"
            : available <= 0
              ? "no_stock"
              : "price_above_max";
        await query(
          tx,
          "INSERT INTO dropped_events (event_id, event_type, reason, payload) VALUES ($1, $2, $3, $4)",
          [event.event_id, event.type, reason, JSON.stringify(event.payload)],
        );
        deps.log.info(
          { type: event.type, sku, reason },
          "gate: no match; event dropped and logged",
        );
      } else {
        deps.log.info({ type: event.type, sku, matched }, "gate: watches matched");
      }
    });
  };
}
