import type { Scripted } from "@ac/agent-runtime";

type Product = { sku: string; name: string; available: number };

/** Grams from a name such as "Coffee beans 1 kg" or "Coffee beans 500 g". */
function grams(name: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(kg|g)\b/i.exec(name);
  if (!m) return null;
  return Number(m[1]) * (m[2]?.toLowerCase() === "kg" ? 1000 : 1);
}

const scripted: Scripted = async ({ event, call, emit }) => {
  if (event.type !== "composition.requested") return;
  const { sku, quantity } = event.payload;
  const all = await call<Product[]>("search_products", { query: "" });
  const target = all.find((p) => p.sku === sku);
  const size = target ? grams(target.name) : null;
  if (!target || !size) {
    await emit("composition.proposed", { items: [], note: `no pack size known for ${sku}` });
    return "no composition";
  }
  const family = target.name
    .replace(/(\d+(?:\.\d+)?)\s*(kg|g)\b/i, "")
    .trim()
    .toLowerCase();
  const need = size * quantity;
  const candidates = all
    .filter((p) => p.sku !== sku && p.name.toLowerCase().startsWith(family) && grams(p.name))
    .sort((a, b) => (grams(b.name) ?? 0) - (grams(a.name) ?? 0));
  for (const c of candidates) {
    const n = Math.ceil(need / (grams(c.name) ?? need));
    if (c.available >= n) {
      await emit("composition.proposed", {
        items: [{ sku: c.sku, quantity: n }],
        note: `${n} x ${c.name} = ${n * (grams(c.name) ?? 0)} g for the missing ${need} g`,
      });
      return `proposed ${n} x ${c.sku}`;
    }
  }
  await emit("composition.proposed", { items: [], note: "no other pack size in stock" });
  return "no composition";
};

export default scripted;
