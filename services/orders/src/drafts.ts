import { type Pool, type PoolClient, query, withTransaction } from "@ac/db";
import { type Envelope, newEvent } from "@ac/events";
import type { Logger } from "@ac/log";
import { GuardError, type ToolClient } from "@ac/mcp-kit";
import { config } from "./config.ts";

export type Db = Pool | PoolClient;
export type Item = { sku: string; quantity: number };
export type OfferItem = Item & { name: string; unit_price: number; line_total: number };
export type Address = { line1: string; city: string; postcode: string };

export type Draft = {
  draft_id: string;
  customer_id: string;
  sku: string;
  quantity: number;
  max_price: number | null;
  state: string;
  delivery_status: string | null;
  payment_status: string | null;
  address: Address;
  current_offer_version: number;
  address_wait_until: string | null;
  created_at: string;
  updated_at: string;
};

export type Offer = {
  offer_id: string;
  draft_id: string;
  version: number;
  items: OfferItem[];
  items_total: number;
  shipping_fee: number;
  total: number;
  status: string;
  expires_at: string;
  decision_id: string | null;
  created_at: string;
};

export type Deps = {
  pool: Pool;
  catalogue: ToolClient;
  customers: ToolClient;
  shipping: ToolClient;
  log: Logger;
};

export async function writeOutbox(tx: Db, event: Envelope): Promise<void> {
  await query(tx, "INSERT INTO outbox (event) VALUES ($1)", [JSON.stringify(event)]);
}

/** The one path to the customer (design rule 11): notification.requested goes out only through the outbox. */
export async function notify(
  tx: Db,
  draft: Pick<Draft, "draft_id" | "current_offer_version">,
  reason: string,
  decisionIds: (string | null | undefined)[],
): Promise<void> {
  await writeOutbox(
    tx,
    newEvent({
      type: "notification.requested",
      payload: { reason, decision_ids: decisionIds.filter((d): d is string => Boolean(d)) },
      draft_id: draft.draft_id,
      offer_version: draft.current_offer_version || null,
    }),
  );
}

export async function history(
  tx: Db,
  draftId: string,
  what: string,
  extra: { event_type?: string; decision_id?: string | null; detail?: unknown } = {},
): Promise<void> {
  await query(
    tx,
    "INSERT INTO draft_history (draft_id, what, event_type, decision_id, detail) VALUES ($1, $2, $3, $4, $5)",
    [
      draftId,
      what,
      extra.event_type ?? null,
      extra.decision_id ?? null,
      JSON.stringify(extra.detail ?? null),
    ],
  );
}

export async function lockDraft(tx: PoolClient, draftId: string): Promise<Draft | undefined> {
  const r = await query<Draft>(tx, "SELECT * FROM drafts WHERE draft_id = $1 FOR UPDATE", [
    draftId,
  ]);
  return r.rows[0];
}

export async function draftView(db: Db, draftId: string) {
  const d = await query<Draft>(db, "SELECT * FROM drafts WHERE draft_id = $1", [draftId]);
  const draft = d.rows[0];
  if (!draft) return null;
  const offers = await query<Offer>(
    db,
    "SELECT * FROM offers WHERE draft_id = $1 ORDER BY version",
    [draftId],
  );
  const watch = await query(
    db,
    "SELECT watch_id, sku, quantity, max_price, status, expires_at FROM stock_watches WHERE draft_id = $1 ORDER BY created_at DESC LIMIT 1",
    [draftId],
  );
  const current = offers.rows.find((o) => o.version === draft.current_offer_version) ?? null;
  return { ...draft, offer: current, offers: offers.rows, watch: watch.rows[0] ?? null };
}

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export function assertDraftId(draftId: string): void {
  if (!isUuid(draftId)) throw new GuardError(`draft_id is not a UUID: ${draftId}`);
}

type Product = { sku: string; name: string; unit_price: number; available: number };

/**
 * Makes a new offer version for a draft (design §6 orders guard, §9 limits).
 * Prices come from the catalogue and the fee from the shipping mock, never from the caller.
 * Version 4 is not made: the draft is cancelled and the customer is told.
 */
export async function createOffer(
  deps: Deps,
  draftId: string,
  items: Item[],
  decisionId: string | null,
) {
  assertDraftId(draftId);
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.sku, (merged.get(i.sku) ?? 0) + i.quantity);
  const wanted = [...merged].map(([sku, quantity]) => ({ sku, quantity }));

  const products = await deps.catalogue.call<Product[]>("get_products", {
    skus: wanted.map((i) => i.sku),
  });
  const lines: OfferItem[] = wanted.map((i) => {
    const p = products.find((x) => x.sku === i.sku);
    if (!p) throw new GuardError(`unknown SKU ${i.sku}`);
    if (p.available < i.quantity)
      throw new GuardError(
        `not enough stock: ${i.sku} has ${p.available}, offer needs ${i.quantity}`,
      );
    return {
      sku: i.sku,
      name: p.name,
      quantity: i.quantity,
      unit_price: p.unit_price,
      line_total: p.unit_price * i.quantity,
    };
  });

  let fee = config.defaultShippingFee;
  try {
    const quote = await deps.shipping.call<{ fee: number } | null>("get_quote", {
      draft_id: draftId,
    });
    if (quote) fee = quote.fee;
  } catch (error) {
    deps.log.warn(
      { err: error, draft_id: draftId },
      "no quote from the shipping mock; default fee",
    );
  }

  return withTransaction(deps.pool, async (tx) => {
    const draft = await lockDraft(tx, draftId);
    if (!draft) throw new GuardError(`unknown draft ${draftId}`);
    const count = await query<{ n: number }>(
      tx,
      "SELECT count(*)::int AS n FROM offers WHERE draft_id = $1",
      [draftId],
    );
    const version = (count.rows[0]?.n ?? 0) + 1;

    if (version > config.maxOfferVersions) {
      await query(
        tx,
        "UPDATE drafts SET state = 'cancelled', updated_at = now() WHERE draft_id = $1",
        [draftId],
      );
      await query(
        tx,
        "UPDATE offers SET status = 'superseded' WHERE draft_id = $1 AND status = 'open'",
        [draftId],
      );
      await history(
        tx,
        draftId,
        `cancelled: offer version limit (${config.maxOfferVersions}) reached`,
        { decision_id: decisionId },
      );
      await notify(tx, draft, "order_cancelled", [decisionId]);
      return {
        cancelled: true,
        reason: `the limit of ${config.maxOfferVersions} offer versions is reached; the draft is cancelled and the customer is told`,
      };
    }

    const itemsTotal = lines.reduce((sum, l) => sum + l.line_total, 0);
    if (draft.max_price !== null && itemsTotal > draft.max_price * draft.quantity) {
      throw new GuardError(
        `over budget: items cost ${itemsTotal}, the customer allows ${draft.max_price * draft.quantity} (cents)`,
      );
    }

    const offer = {
      offer_id: crypto.randomUUID(),
      version,
      items: lines,
      items_total: itemsTotal,
      shipping_fee: fee,
      total: itemsTotal + fee,
    };
    await query(
      tx,
      "UPDATE offers SET status = 'superseded' WHERE draft_id = $1 AND status = 'open'",
      [draftId],
    );
    const inserted = await query<{ expires_at: string }>(
      tx,
      `INSERT INTO offers (offer_id, draft_id, version, items, items_total, shipping_fee, total, status, expires_at, decision_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', now() + make_interval(mins => $8), $9) RETURNING expires_at`,
      [
        offer.offer_id,
        draftId,
        version,
        JSON.stringify(lines),
        itemsTotal,
        fee,
        offer.total,
        config.offerTtlMinutes,
        decisionId,
      ],
    );
    await query(
      tx,
      `UPDATE drafts SET state = 'offered', current_offer_version = $2, delivery_status = NULL,
              payment_status = NULL, address_wait_until = NULL, updated_at = now() WHERE draft_id = $1`,
      [draftId, version],
    );
    await query(
      tx,
      "UPDATE stock_watches SET status = 'closed' WHERE draft_id = $1 AND status = 'open'",
      [draftId],
    );
    await history(tx, draftId, `offer v${version}: total ${offer.total}`, {
      decision_id: decisionId,
      detail: offer,
    });
    await notify(tx, { draft_id: draftId, current_offer_version: version }, "offer_ready", [
      decisionId,
    ]);
    return { cancelled: false, offer: { ...offer, expires_at: inserted.rows[0]?.expires_at } };
  });
}
