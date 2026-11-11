import type { Scripted } from "@ac/agent-runtime";

const scripted: Scripted = async ({ event, call, emit }) => {
  const draft_id = event.draft_id;
  if (!draft_id) return "no draft";
  if (event.type === "order.confirmed" || event.type === "address.provided") {
    const geo = await call("geocode", { draft_id });
    if (!geo.resolved) {
      await emit("shipment.failed", { reason: "address_unresolved" });
      return "address does not resolve";
    }
    const q = await call("quote", { draft_id });
    if (q.matches) {
      await emit("shipment.quoted", { quote_id: q.quote_id, fee: q.fee });
      return `quoted ${q.fee}`;
    }
    await emit("shipment.failed", { reason: "quote_mismatch" });
    return `quote ${q.fee} differs from the agreed ${q.agreed_fee}`;
  }
  if (event.type === "payment.authorized") {
    const b = await call("book", { draft_id });
    if (b.booked) {
      await emit("shipment.booked", { tracking_id: b.tracking_id });
      return `booked ${b.tracking_id}`;
    }
    await emit("shipment.failed", { reason: "courier_unavailable" });
    return `not booked: ${b.detail ?? b.reason}`;
  }
  return "ignored";
};

export default scripted;
