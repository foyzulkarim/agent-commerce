import type { Scripted } from "@ac/agent-runtime";

type Item = { name: string; quantity: number; unit_price: number; line_total: number };
type Draft = {
  draft_id: string;
  address: { line1: string; city: string; postcode: string };
  offer: {
    version: number;
    items: Item[];
    shipping_fee: number;
    total: number;
    expires_at: string;
  } | null;
};
type Decision = { agent: string; output_text: string };

const aud = (cents: number) => `AUD ${(cents / 100).toFixed(2)}`;

const scripted: Scripted = async ({ event, call }) => {
  if (event.type !== "notification.requested") return;
  const { reason, decision_ids } = event.payload;
  const draftId = event.draft_id;
  if (!draftId) return "no draft";
  const draft = await call<Draft>("get_draft", { draft_id: draftId });
  const decisions =
    decision_ids.length > 0 ? await call<Decision[]>("read_decisions", { decision_ids }) : [];
  const why = decisions
    .map((d) => `${d.agent} agent: ${d.output_text}`)
    .filter((t) => t.length > 10);

  let subject = `Update on your order (${reason})`;
  let body = `There is an update on your order: ${reason.replaceAll("_", " ")}.`;
  const o = draft.offer;
  switch (reason) {
    case "offer_ready":
      if (o) {
        const lines = o.items.map(
          (i) => `- ${i.quantity} x ${i.name} at ${aud(i.unit_price)} = ${aud(i.line_total)}`,
        );
        subject = `Your offer is ready (version ${o.version})`;
        body = [
          "Good news. We can offer you:",
          ...lines,
          `Shipping: ${aud(o.shipping_fee)}`,
          `Total: ${aud(o.total)}`,
          `The offer is open until ${new Date(o.expires_at).toUTCString()}.`,
          why.length ? `Why this offer: ${why.join(" ")}` : "",
          "Use the buttons below to approve or reject. Nothing is charged before the parcel leaves.",
        ]
          .filter(Boolean)
          .join("\n");
      }
      break;
    case "address_question":
      subject = "We need your delivery address";
      body = `We could not find this address: ${draft.address.line1}, ${draft.address.city} ${draft.address.postcode}.\nPlease send a correct delivery address with the form below.`;
      break;
    case "order_dispatched":
      subject = "Your parcel is on its way";
      body = "Your parcel has left our warehouse. We charged the agreed total now.";
      break;
    case "order_delivered":
      subject = "Your parcel is delivered";
      body = "Your parcel is delivered. Thank you for your order.";
      break;
    case "payment_failed":
      subject = "Your payment did not go through";
      body = "The bank did not approve the payment. Nothing is charged. The order is closed.";
      break;
    case "order_cancelled":
      subject = "Your order is cancelled";
      body =
        "We could not deliver this order after several tries. The order is cancelled. Nothing is charged.";
      break;
    case "offer_expired":
    case "watch_expired":
    case "address_expired":
      subject = "Your request has ended";
      body =
        "The time to answer has ended, so the order is closed. You can ask again in the chat at any time.";
      break;
  }
  await call("send_email", { draft_id: draftId, reason, subject, body, decision_ids });
  return `${reason} email sent`;
};

export default scripted;
