import type { Pool } from "@ac/db";
import { query, withTransaction } from "@ac/db";
import { readDecisionsForDraft } from "@ac/decisions";
import { newEvent } from "@ac/events";
import { escapeHtml, type FastifyInstance, htmlPage, ToolError, wantsHtml } from "@ac/mcp-kit";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "./config.ts";
import {
  type Deps,
  type Draft,
  draftView,
  history,
  lockDraft,
  type Offer,
  writeOutbox,
} from "./drafts.ts";
import { tick } from "./timer.ts";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** One answer for a page form and for curl: HTML for a browser, JSON otherwise. */
function answer(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  title: string,
  data: Record<string, unknown>,
) {
  reply.status(status);
  if (!wantsHtml(request)) return reply.send({ ok: status < 400, message: title, ...data });
  const back = process.env.PUBLIC_BASE_URL_EMAIL ?? "http://localhost:3002";
  return reply
    .type("text/html")
    .send(
      htmlPage(
        title,
        `<p>${escapeHtml(data.detail ?? "")}</p><p><a href="${escapeHtml(back)}">Back to the inbox</a></p>`,
      ),
    );
}

/**
 * Response endpoints (design §3): the customer's answers from the inbox links.
 * Plain HTTP, so the inbox form and curl use the same call.
 */
export function registerEndpoints(app: FastifyInstance, deps: Deps, decisions: Pool): void {
  const { pool, catalogue, log } = deps;

  app.post<{ Params: { offer_id: string } }>(
    "/offers/:offer_id/approve",
    async (request, reply) => {
      const { offer_id } = request.params;
      if (!isUuid(offer_id))
        return answer(request, reply, 400, "Bad offer id", { detail: offer_id });
      const o = await query<Offer & { state: string; current_offer_version: number }>(
        pool,
        `SELECT o.*, d.state, d.current_offer_version FROM offers o JOIN drafts d ON d.draft_id = o.draft_id
        WHERE o.offer_id = $1`,
        [offer_id],
      );
      const offer = o.rows[0];
      if (!offer) return answer(request, reply, 404, "Offer not found", { detail: offer_id });
      if (
        offer.status !== "open" ||
        offer.state !== "offered" ||
        offer.version !== offer.current_offer_version
      ) {
        return answer(request, reply, 409, "This offer is closed", {
          detail: `offer is ${offer.status}, draft is ${offer.state}`,
          draft_id: offer.draft_id,
        });
      }
      if (new Date(offer.expires_at) < new Date()) {
        return answer(request, reply, 409, "This offer has expired", {
          detail: `expired at ${offer.expires_at}`,
          draft_id: offer.draft_id,
        });
      }

      let reserveError: string | null = null;
      try {
        await catalogue.call("reserve_stock", {
          draft_id: offer.draft_id,
          offer_version: offer.version,
          items: offer.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        });
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        reserveError = error.message;
      }

      const result = await withTransaction(pool, async (tx) => {
        const draft = await lockDraft(tx, offer.draft_id);
        const current = await query<{ status: string }>(
          tx,
          "SELECT status FROM offers WHERE offer_id = $1 FOR UPDATE",
          [offer_id],
        );
        if (draft?.state !== "offered" || current.rows[0]?.status !== "open")
          return "closed" as const;
        if (reserveError) {
          // Sold out at approve (design §8: offered → waiting). Watch the requested SKU again.
          await query(tx, "UPDATE offers SET status = 'sold_out' WHERE offer_id = $1", [offer_id]);
          await query(
            tx,
            "UPDATE drafts SET state = 'waiting', updated_at = now() WHERE draft_id = $1",
            [draft.draft_id],
          );
          await query(
            tx,
            `INSERT INTO stock_watches (watch_id, draft_id, sku, quantity, max_price, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'open', now() + make_interval(mins => $6))`,
            [
              crypto.randomUUID(),
              draft.draft_id,
              draft.sku,
              draft.quantity,
              draft.max_price,
              config.watchTtlMinutes,
            ],
          );
          await history(
            tx,
            draft.draft_id,
            `approve failed: sold out; waiting again (${reserveError})`,
          );
          return "sold_out" as const;
        }
        await query(tx, "UPDATE offers SET status = 'approved' WHERE offer_id = $1", [offer_id]);
        await query(
          tx,
          "UPDATE drafts SET state = 'confirmed', delivery_status = NULL, payment_status = NULL, updated_at = now() WHERE draft_id = $1",
          [draft.draft_id],
        );
        await writeOutbox(
          tx,
          newEvent({
            type: "order.confirmed",
            payload: { offer_version: offer.version },
            draft_id: draft.draft_id,
            offer_version: offer.version,
          }),
        );
        await history(tx, draft.draft_id, `approved offer v${offer.version}; stock reserved`, {
          event_type: "order.confirmed",
        });
        return "confirmed" as const;
      });

      log.info({ offer_id, draft_id: offer.draft_id, result }, "approve");
      if (result === "closed")
        return answer(request, reply, 409, "This offer is closed", { draft_id: offer.draft_id });
      if (result === "sold_out") {
        return answer(request, reply, 409, "Sold out", {
          detail: "The stock is gone. We watch the product and send a new offer when it returns.",
          draft_id: offer.draft_id,
        });
      }
      return answer(request, reply, 200, "Thank you. Your order is confirmed", {
        detail: "We book the courier and email you when the parcel leaves.",
        draft_id: offer.draft_id,
        offer_version: offer.version,
      });
    },
  );

  app.post<{ Params: { offer_id: string } }>("/offers/:offer_id/reject", async (request, reply) => {
    const { offer_id } = request.params;
    if (!isUuid(offer_id)) return answer(request, reply, 400, "Bad offer id", { detail: offer_id });
    const result = await withTransaction(pool, async (tx) => {
      const o = await query<{ draft_id: string; status: string; version: number }>(
        tx,
        "SELECT draft_id, status, version FROM offers WHERE offer_id = $1 FOR UPDATE",
        [offer_id],
      );
      const offer = o.rows[0];
      if (!offer) return { status: 404, title: "Offer not found" };
      const draft = await lockDraft(tx, offer.draft_id);
      if (offer.status !== "open" || draft?.state !== "offered")
        return { status: 409, title: "This offer is closed", draft_id: offer.draft_id };
      await query(tx, "UPDATE offers SET status = 'rejected' WHERE offer_id = $1", [offer_id]);
      await query(
        tx,
        "UPDATE drafts SET state = 'rejected', updated_at = now() WHERE draft_id = $1",
        [offer.draft_id],
      );
      await query(
        tx,
        "UPDATE stock_watches SET status = 'closed' WHERE draft_id = $1 AND status = 'open'",
        [offer.draft_id],
      );
      await history(tx, offer.draft_id, `rejected offer v${offer.version}`);
      return { status: 200, title: "Offer rejected", draft_id: offer.draft_id };
    });
    return answer(request, reply, result.status, result.title, {
      draft_id: result.draft_id,
      detail: result.status === 200 ? "Nothing is charged." : "",
    });
  });

  const AddressBody = z.object({
    line1: z.string().trim().min(3).max(120),
    city: z.string().trim().min(2).max(80),
    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "4 digits"),
  });

  app.post<{ Params: { draft_id: string } }>(
    "/drafts/:draft_id/address",
    async (request, reply) => {
      const { draft_id } = request.params;
      if (!isUuid(draft_id))
        return answer(request, reply, 400, "Bad draft id", { detail: draft_id });
      const body = AddressBody.safeParse(request.body);
      if (!body.success)
        return answer(request, reply, 400, "Check the address", {
          detail: z.prettifyError(body.error),
        });
      const result = await withTransaction(pool, async (tx) => {
        const draft = await lockDraft(tx, draft_id);
        if (!draft) return { status: 404, title: "Order not found" };
        if (draft.state !== "confirmed" || draft.delivery_status !== "address_pending") {
          return {
            status: 409,
            title: "No address question is open",
            detail: `draft is ${draft.state}`,
          };
        }
        await query(
          tx,
          "UPDATE drafts SET address = $2, delivery_status = NULL, address_wait_until = NULL, updated_at = now() WHERE draft_id = $1",
          [draft_id, JSON.stringify(body.data)],
        );
        await writeOutbox(
          tx,
          newEvent({
            type: "address.provided",
            payload: {},
            draft_id,
            offer_version: draft.current_offer_version,
          }),
        );
        await history(
          tx,
          draft_id,
          `address changed: ${body.data.line1}, ${body.data.city} ${body.data.postcode}`,
          { event_type: "address.provided" },
        );
        return {
          status: 200,
          title: "Thank you. We try the delivery again",
          detail: "We email you when the parcel leaves.",
        };
      });
      return answer(request, reply, result.status, result.title, {
        detail: result.detail,
        draft_id,
      });
    },
  );

  /** The Clock (design §3): a schedule calls tick(); a presenter can call it, and move time forward. */
  app.post("/timer/tick", async (request) => {
    const body = z
      .object({ advance_minutes: z.coerce.number().min(0).max(100_000).optional() })
      .safeParse(request.body ?? {});
    const advance = body.success ? (body.data.advance_minutes ?? 0) : 0;
    return tick(deps, new Date(Date.now() + advance * 60_000));
  });

  /** Read views for the board page and for scripts. */
  app.get("/drafts", async (request) => {
    const q = z.object({ customer_id: z.string().optional() }).parse(request.query ?? {});
    const r = await query<Draft & { total: number | null }>(
      pool,
      `SELECT d.*, o.total FROM drafts d
         LEFT JOIN offers o ON o.draft_id = d.draft_id AND o.version = d.current_offer_version
        WHERE ($1::text IS NULL OR d.customer_id = $1) ORDER BY d.created_at DESC LIMIT 50`,
      [q.customer_id ?? null],
    );
    return r.rows;
  });

  app.get<{ Params: { draft_id: string } }>("/drafts/:draft_id", async (request, reply) => {
    const { draft_id } = request.params;
    if (!isUuid(draft_id)) return reply.status(400).send({ error: "bad draft id" });
    const view = await draftView(pool, draft_id);
    if (!view) return reply.status(404).send({ error: "not found" });
    const h = await query(
      pool,
      "SELECT what, event_type, decision_id, at FROM draft_history WHERE draft_id = $1 ORDER BY id",
      [draft_id],
    );
    const decisionRows = await readDecisionsForDraft(decisions, draft_id);
    return { ...view, history: h.rows, decisions: decisionRows };
  });

  app.get("/dropped", async () => {
    const r = await query(pool, "SELECT * FROM dropped_events ORDER BY id DESC LIMIT 50");
    return r.rows;
  });
}
