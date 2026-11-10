import path from "node:path";
import { startDatabase } from "@ac/db";
import { log } from "@ac/log";
import { createApp, registerMcp } from "@ac/mcp-kit";
import { ordersTools } from "./tools.ts";

const logger = log("orders");
const PORT = Number(process.env.PORT ?? 3001);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://ac:ac@postgres:5432/orders";
const here = import.meta.dirname;

const pool = await startDatabase({
  databaseUrl: DATABASE_URL,
  migrationsDir: path.join(here, "..", "migrations"),
  seedDir: path.join(here, "..", "seed"),
  log: logger,
});

const app = createApp();
app.get("/health", async () => ({ ok: true, service: "orders" }));
registerMcp(app, { name: "orders", tools: ordersTools(pool), log: logger });

await app.listen({ port: PORT, host: "0.0.0.0" });
logger.info({ port: PORT }, "orders listening; MCP on /mcp");
