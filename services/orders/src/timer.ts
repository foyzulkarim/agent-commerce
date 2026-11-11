import { query, withTransaction } from "@ac/db";
import type { Deps } from "./drafts.ts";
import { history, notify } from "./drafts.ts";

/**
 * The Timer (the Clock actor, design §3): closes waits that are overdue.
 * It writes drafts and the outbox; it does not publish (design §2 note).
 * `now` can be moved forward for the demo: POST /timer/tick {"advance_minutes": 60}.
 */
export async function tick(deps: Deps, now: Date = new Date()) {
  const at = now.toISOString();
  return withTransaction(deps.pool, async (tx) => {
    const offers = await query<{ offer_id: string; draft_id: string; version: number }>(
      tx,
      `UPDATE offers SET status = 'expired' WHERE status = 'open' AND expires_at < $1
       RETURNING offer_id, draft_id, version`,
      [at],
    );
    for (const o of offers.rows) {
      const d = await query(
        tx,
        `UPDATE drafts SET state = 'expired', updated_at = now()
          WHERE draft_id = $1 AND state = 'offered' AND current_offer_version = $2`,
        [o.draft_id, o.version],
      );
      if (d.rowCount) {
        await history(tx, o.draft_id, `offer v${o.version} expired`);
        await notify(
          tx,
          { draft_id: o.draft_id, current_offer_version: o.version },
          "offer_expired",
          [],
        );
      }
    }

    const watches = await query<{ draft_id: string }>(
      tx,
      "UPDATE stock_watches SET status = 'expired' WHERE status = 'open' AND expires_at < $1 RETURNING draft_id",
      [at],
    );
    for (const w of watches.rows) {
      const d = await query(
        tx,
        "UPDATE drafts SET state = 'expired', updated_at = now() WHERE draft_id = $1 AND state = 'waiting'",
        [w.draft_id],
      );
      if (d.rowCount) {
        await history(tx, w.draft_id, "watch expired");
        await notify(tx, { draft_id: w.draft_id, current_offer_version: 0 }, "watch_expired", []);
      }
    }

    const waits = await query<{ draft_id: string; current_offer_version: number }>(
      tx,
      `UPDATE drafts SET state = 'expired', updated_at = now()
        WHERE state = 'confirmed' AND delivery_status = 'address_pending' AND address_wait_until < $1
        RETURNING draft_id, current_offer_version`,
      [at],
    );
    for (const d of waits.rows) {
      await history(tx, d.draft_id, "address wait expired");
      await notify(tx, d, "address_expired", []);
    }

    const counts = {
      offers: offers.rowCount ?? 0,
      watches: watches.rowCount ?? 0,
      address_waits: waits.rowCount ?? 0,
    };
    if (counts.offers + counts.watches + counts.address_waits > 0)
      deps.log.info({ ...counts, now: at }, "timer expired waits");
    return { now: at, expired: counts };
  });
}
