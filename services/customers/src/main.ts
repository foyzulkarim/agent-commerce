import path from "node:path";
import { query, startDatabase } from "@ac/db";
import { log } from "@ac/log";
import { createApp, registerMcp } from "@ac/mcp-kit";
import { customersTools } from "./tools.ts";

const logger = log("customers");
const PORT = Number(process.env.PORT ?? 3005);
const here = import.meta.dirname;

const pool = await startDatabase({
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ac:ac@postgres:5432/customers",
  migrationsDir: path.join(here, "..", "migrations"),
  seedDir: path.join(here, "..", "seed"),
  log: logger,
});

const app = createApp();
app.get("/health", async () => ({ ok: true, service: "customers" }));
/** For the demo login on the chat page and the inbox page. Names and ids only. */
app.get("/customers", async () => {
  const result = await query(pool, "SELECT customer_id, name FROM customers ORDER BY name");
  return result.rows;
});
registerMcp(app, { name: "customers", tools: customersTools(pool), log: logger });

await app.listen({ port: PORT, host: "0.0.0.0" });
logger.info({ port: PORT }, "customers listening; MCP on /mcp");
