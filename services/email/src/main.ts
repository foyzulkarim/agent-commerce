import path from "node:path";
import { query, startDatabase } from "@ac/db";
import { log } from "@ac/log";
import { connectTool, createApp, registerMcp } from "@ac/mcp-kit";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { emailTools } from "./tools.ts";

const logger = log("email");
const PORT = Number(process.env.PORT ?? 3002);
const here = import.meta.dirname;
const ordersUrl = process.env.PUBLIC_BASE_URL_ORDERS ?? "http://localhost:3001";
const customersUrl = process.env.CUSTOMERS_URL ?? "http://customers:3005";

const pool = await startDatabase({
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ac:ac@postgres:5432/email",
  migrationsDir: path.join(here, "..", "migrations"),
  log: logger,
});
const orders = connectTool(process.env.ORDERS_MCP ?? "http://orders:3001/mcp", "email");
const customers = connectTool(process.env.CUSTOMERS_MCP ?? "http://customers:3005/mcp", "email");

const app = createApp();
await app.register(fastifyStatic, { root: path.join(here, "..", "public") });
app.get("/health", async () => ({ ok: true, service: "email" }));

/** The inbox page reads these. */
app.get("/emails", async (request) => {
  const q = z.object({ customer_id: z.string().optional() }).parse(request.query ?? {});
  const r = await query(
    pool,
    `SELECT email_id, customer_id, to_address, draft_id, reason, subject, body, decision_ids, actions, created_at
       FROM emails WHERE ($1::text IS NULL OR customer_id = $1) ORDER BY created_at DESC LIMIT 100`,
    [q.customer_id ?? null],
  );
  return r.rows;
});
app.get("/customers", async () => {
  const res = await fetch(`${customersUrl}/customers`);
  return res.json();
});

registerMcp(app, {
  name: "email",
  tools: emailTools(pool, orders, customers, ordersUrl, logger),
  log: logger,
});

await app.listen({ port: PORT, host: "0.0.0.0" });
logger.info({ port: PORT }, "email listening; inbox on /, MCP on /mcp");
