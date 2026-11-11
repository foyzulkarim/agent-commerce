import type { Scripted } from "@ac/agent-runtime";

type Item = { sku: string; quantity: number };
type Draft = { draft_id: string; sku: string; quantity: number; offer: { items: Item[] } | null };
type Product = { sku: string; available: number };

const scripted: Scripted = async ({ event, call, emit }) => {
  const draftId = event.draft_id;
  if (!draftId) return "no draft";
  const draft = await call<Draft>("get_draft", { draft_id: draftId });
  const propose = async (items: Item[]) => {
    const r = await call("propose_offer", { draft_id: draftId, items });
    return r.cancelled ? `cancelled: ${r.reason}` : `offer v${r.offer.version}`;
  };

  switch (event.type) {
    case "watch.matched": {
      const available = event.payload.available_qty;
      if (available >= draft.quantity)
        return propose([{ sku: draft.sku, quantity: draft.quantity }]);
      await emit("composition.requested", { sku: draft.sku, quantity: draft.quantity - available });
      return `asked for a composition of ${draft.quantity - available} x ${draft.sku}`;
    }
    case "composition.proposed": {
      const [product] = (await call<Product[]>("search_products", { query: draft.sku })).filter(
        (p) => p.sku === draft.sku,
      );
      const take = Math.min(product?.available ?? 0, draft.quantity);
      const items: Item[] = take > 0 ? [{ sku: draft.sku, quantity: take }] : [];
      items.push(...event.payload.items);
      if (items.length === 0) return "nothing to offer";
      return propose(items);
    }
    case "shipment.failed": {
      if (event.payload.reason === "address_unresolved") return "address question: not for me";
      if (!draft.offer) return "no offer to repeat";
      return propose(draft.offer.items.map(({ sku, quantity }) => ({ sku, quantity })));
    }
    default:
      return "ignored";
  }
};

export default scripted;
