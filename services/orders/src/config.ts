/** Settings of the orders container (landscape §7). Minutes are short for the demo. */
const minutes = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

function duration(text: string): number {
  const m = /^(\d+)\s*(ms|s|m)?$/.exec(text.trim());
  if (!m) return 30_000;
  const n = Number(m[1]);
  return m[2] === "m" ? n * 60_000 : m[2] === "ms" ? n : n * 1000;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ac:ac@postgres:5432/orders",
  decisionsUrl: process.env.DECISIONS_DATABASE_URL ?? "postgres://ac:ac@postgres:5432/decisions",
  amqpUrl: process.env.AMQP_URL ?? "amqp://ac:ac@rabbitmq:5672",
  catalogueMcp: process.env.CATALOGUE_MCP ?? "http://catalogue-mock:3003/mcp",
  customersMcp: process.env.CUSTOMERS_MCP ?? "http://customers:3005/mcp",
  shippingMcp: process.env.SHIPPING_MCP ?? "http://shipping-mock:3004/mcp",
  offerTtlMinutes: minutes("OFFER_TTL", 10),
  watchTtlMinutes: minutes("WATCH_TTL", 60),
  addressTtlMinutes: minutes("ADDRESS_TTL", 10),
  timerIntervalMs: duration(process.env.TIMER_INTERVAL ?? "30s"),
  maxOfferVersions: 3,
  /** Shipping fee in an offer when the shipping mock has no quote for the draft yet (cents). */
  defaultShippingFee: Number(process.env.DEFAULT_SHIPPING_FEE ?? 1000),
};
