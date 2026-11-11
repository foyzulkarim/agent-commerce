import type { Bus } from "@ac/bus";
import { type Pool, query, withTransaction } from "@ac/db";
import type { Envelope } from "@ac/events";
import type { Logger } from "@ac/log";

/** Outbox relay (landscape #15): poll every 500 ms, batch 50, FOR UPDATE SKIP LOCKED. */
export function startRelay(pool: Pool, bus: Bus, log: Logger, intervalMs = 500): () => void {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await withTransaction(pool, async (tx) => {
        const rows = await query<{ id: string; event: Envelope }>(
          tx,
          "SELECT id, event FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED",
        );
        for (const row of rows.rows) await bus.publish(row.event);
        if (rows.rowCount) {
          await query(tx, "UPDATE outbox SET published_at = now() WHERE id = ANY($1)", [
            rows.rows.map((r) => r.id),
          ]);
          log.info({ published: rows.rows.map((r) => r.event.type) }, "outbox relayed");
        }
      });
    } catch (error) {
      log.error({ err: error }, "outbox relay failed; retry on the next poll");
    } finally {
      busy = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
