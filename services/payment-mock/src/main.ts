import path from "node:path";
import { query, startDatabase } from "@ac/db";
import { log } from "@ac/log";
import { connectTool, createApp, registerMcp } from "@ac/mcp-kit";
import { paymentTools } from "./tools.ts";

const logger = log("payment-mock");
const PORT = Number(process.env.PORT ?? 3006);
const here = import.meta.dirname;

const pool = await startDatabase({
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ac:ac@postgres:5432/payment",
  migrationsDir: path.join(here, "..", "migrations"),
  log: logger,
});
const orders = connectTool(process.env.ORDERS_MCP ?? "http://orders:3001/mcp", "payment-mock");
const customers = connectTool(
  process.env.CUSTOMERS_MCP ?? "http://customers:3005/mcp",
  "payment-mock",
);
const shipping = connectTool(
  process.env.SHIPPING_MCP ?? "http://shipping-mock:3004/mcp",
  "payment-mock",
);

const app = createApp();
app.get("/health", async () => ({ ok: true, service: "payment-mock" }));
app.get("/authorizations", async () => {
  const r = await query(pool, "SELECT * FROM authorizations ORDER BY created_at DESC LIMIT 50");
  return r.rows;
});
registerMcp(app, {
  name: "payment",
  tools: paymentTools(pool, orders, customers, shipping),
  log: logger,
});

await app.listen({ port: PORT, host: "0.0.0.0" });
logger.info({ port: PORT }, "payment-mock listening; MCP on /mcp");
