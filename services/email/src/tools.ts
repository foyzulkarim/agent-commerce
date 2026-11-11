import { type Pool, query } from "@ac/db";
import type { Logger } from "@ac/log";
import { defineTool, GuardError, type ToolClient } from "@ac/mcp-kit";
import { z } from "zod";

type DraftView = {
  draft_id: string;
  customer_id: string;
  state: string;
  delivery_status: string | null;
  offer: { offer_id: string; version: number; status: string; total: number } | null;
};

export type Action =
  | { kind: "button"; label: string; url: string }
  | { kind: "address_form"; label: string; url: string };

/** Links in an email come from code (the orders public URL), never from the agent. */
export function actionsFor(reason: string, draft: DraftView, ordersUrl: string): Action[] {
  if (reason === "offer_ready" && draft.offer?.status === "open") {
    return [
      {
        kind: "button",
        label: "Approve and order",
        url: `${ordersUrl}/offers/${draft.offer.offer_id}/approve`,
      },
      {
        kind: "button",
        label: "Reject",
        url: `${ordersUrl}/offers/${draft.offer.offer_id}/reject`,
      },
    ];
  }
  if (reason === "address_question" && draft.delivery_status === "address_pending") {
    return [
      {
        kind: "address_form",
        label: "Send a delivery address",
        url: `${ordersUrl}/drafts/${draft.draft_id}/address`,
      },
    ];
  }
  return [];
}

export function emailTools(
  pool: Pool,
  orders: ToolClient,
  customers: ToolClient,
  ordersUrl: string,
  log: Logger,
) {
  const send = defineTool({
    name: "send_email",
    description:
      "Sends one email to the customer of a draft. You never pass an address: the server reads it from Customers. The server adds the action links (approve, reject, address form). Cite the decision_ids that the email explains.",
    input: z.object({
      draft_id: z.string().min(1),
      reason: z
        .string()
        .min(1)
        .describe("the reason from notification.requested, for example offer_ready"),
      subject: z.string().min(3).max(120),
      body: z.string().min(10).max(4000).describe("plain text; amounts in AUD with two decimals"),
      decision_ids: z
        .array(z.string())
        .describe("the decision records this email explains; can be empty"),
    }),
    guard: ({ body }) => {
      if (/https?:\/\//i.test(body))
        throw new GuardError("no links in the body; the server adds the links");
      if (/@[a-z0-9-]+\.[a-z]/i.test(body)) throw new GuardError("no email addresses in the body");
    },
    run: async ({ draft_id, reason, subject, body, decision_ids }) => {
      const draft = await orders.call<DraftView>("get_draft", { draft_id });
      const { email } = await customers.call<{ email: string }>("get_customer_email", {
        customer_id: draft.customer_id,
      });
      const actions = actionsFor(reason, draft, ordersUrl);
      if (reason === "offer_ready" && actions.length === 0) {
        throw new GuardError(
          `no open offer on draft ${draft_id}; the offer email would have no approve link`,
        );
      }
      const email_id = crypto.randomUUID();
      await query(
        pool,
        `INSERT INTO emails (email_id, customer_id, to_address, draft_id, reason, subject, body, decision_ids, actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          email_id,
          draft.customer_id,
          email,
          draft_id,
          reason,
          subject,
          body,
          JSON.stringify(decision_ids),
          JSON.stringify(actions),
        ],
      );
      log.info(
        {
          email_id,
          to: email,
          reason,
          subject,
          body,
          decision_ids,
          actions: actions.map((a) => a.label),
        },
        "EMAIL",
      );
      return {
        email_id,
        to_customer: draft.customer_id,
        reason,
        actions: actions.map((a) => a.label),
      };
    },
  });
  return [send];
}
