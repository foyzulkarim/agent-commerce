import { query, withTransaction } from "@ac/db";
import type { Envelope, EventType } from "@ac/events";
import { config } from "./config.ts";
import { type Deps, history, lockDraft, notify } from "./drafts.ts";

export const STATUS_EVENTS: EventType[] = [
  "shipment.booked",
  "shipment.failed",
  "shipment.dispatched",
  "shipment.delivered",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
];

/**
 * The Status updater (plain code, design §5): changes the draft and, when the customer must know,
 * writes notification.requested to the outbox in the same transaction (edge e30).
 */
export function statusHandler(deps: Deps) {
  return async (event: Envelope): Promise<void> => {
    if (!event.draft_id) return;
    const draftId = event.draft_id;
    await withTransaction(deps.pool, async (tx) => {
      const draft = await lockDraft(tx, draftId);
      if (draft?.state !== "confirmed") {
        const reason = draft ? `draft_${draft.state}` : "unknown_draft";
        await query(
          tx,
          "INSERT INTO dropped_events (event_id, event_type, reason, payload) VALUES ($1, $2, $3, $4)",
          [event.event_id, event.type, reason, JSON.stringify(event.payload)],
        );
        deps.log.info(
          { type: event.type, draft_id: draftId, reason },
          "status updater: event dropped",
        );
        return;
      }
      const set = async (sql: string, ...params: unknown[]) =>
        query(tx, `UPDATE drafts SET ${sql}, updated_at = now() WHERE draft_id = $1`, [
          draftId,
          ...params,
        ]);
      const cite = [event.decision_id];

      switch (event.type) {
        case "shipment.failed":
          if (event.payload.reason === "address_unresolved") {
            await set(
              "delivery_status = 'address_pending', address_wait_until = now() + make_interval(mins => $2)",
              config.addressTtlMinutes,
            );
            await notify(tx, draft, "address_question", cite);
          }
          // quote_mismatch and courier_unavailable: no change; the Offer agent makes a new offer.
          break;
        case "shipment.booked":
          await set("delivery_status = 'booked'");
          break;
        case "shipment.dispatched":
          await set("delivery_status = 'dispatched'");
          await notify(tx, draft, "order_dispatched", cite);
          break;
        case "shipment.delivered":
          await set("delivery_status = 'delivered', state = 'completed'");
          await notify(tx, draft, "order_delivered", cite);
          break;
        case "payment.authorized":
          await set("payment_status = 'authorized'");
          break;
        case "payment.captured":
          await set("payment_status = 'captured'");
          break;
        case "payment.failed":
          await set("state = 'failed'");
          await notify(tx, draft, "payment_failed", cite);
          break;
        default:
          return;
      }
      const reason = "reason" in event.payload ? ` (${event.payload.reason})` : "";
      await history(tx, draftId, `${event.type}${reason}`, {
        event_type: event.type,
        decision_id: event.decision_id,
      });
    });
  };
}
