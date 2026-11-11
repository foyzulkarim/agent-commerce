import type { Scripted } from "@ac/agent-runtime";

type Product = { sku: string; name: string; unit_price: number; available: number };

/**
 * Fixed rules in place of the model (AGENT_MODE=scripted). The text must look like
 * "buy 2 coffee-1kg max 45": quantity, product words, optional maximum dollars per unit.
 */
const scripted: Scripted = async ({ event, call, emit }) => {
  if (event.type !== "chat.message") return;
  const { text, customer_id } = event.payload;
  const reply = (t: string) => emit("chat.reply", { text: t, customer_id });

  const cleaned = text.replace(/^\s*(i want|i would like|buy|order|please)\s+/i, "");
  const m =
    /^(\d+)?\s*(?:x\s+)?(.+?)(?:\s+(?:max|under|up to)\s+\$?(\d+(?:\.\d{1,2})?))?\s*$/i.exec(
      cleaned,
    );
  const quantity = Number(m?.[1] ?? 1);
  const words = (m?.[2] ?? cleaned).replace(/\bof\b/gi, " ");
  const max_price = m?.[3] ? Math.round(Number(m[3]) * 100) : null;

  const found = await call<Product[]>("search_products", { query: words });
  const product = found[0];
  if (!product) {
    await reply(
      `I could not find "${words.trim()}". Try a product name, for example coffee beans or tea.`,
    );
    return "no product";
  }
  const draft = await call("create_draft_order", {
    customer_id,
    sku: product.sku,
    quantity,
    max_price,
  });
  if (draft.state === "offered") {
    await reply(`${product.name} is in stock. I sent an offer for ${quantity} to your inbox.`);
    return `offer for ${product.sku}`;
  }
  await call("register_watch", { draft_id: draft.draft_id, sku: product.sku, quantity, max_price });
  await reply(
    `${product.name} is not available now. I watch it and email you an offer when it is back.`,
  );
  return `watch on ${product.sku}`;
};

export default scripted;
