import type { Scripted } from "@ac/agent-runtime";

const scripted: Scripted = async ({ event, call, emit }) => {
  const draft_id = event.draft_id;
  if (!draft_id) return "no draft";
  switch (event.type) {
    case "shipment.quoted": {
      const a = await call("authorize", { draft_id });
      if (a.result === "approved") {
        await emit("payment.authorized", { authorization_id: a.authorization_id });
        return `authorized ${a.amount}`;
      }
      await emit("payment.failed", { reason: a.result === "declined" ? "declined" : "unknown" });
      return `payment ${a.result}`;
    }
    case "shipment.dispatched": {
      const c = await call("capture", { draft_id });
      await emit("payment.captured", { capture_id: c.capture_id });
      return `captured ${c.amount}`;
    }
    case "shipment.failed": {
      if (event.payload.reason !== "courier_unavailable") return "nothing to do";
      const v = await call("void", { draft_id });
      return v.voided ? "authorization voided" : "nothing to void";
    }
    default:
      return "ignored";
  }
};

export default scripted;
