import path from "node:path";
import { connectBus } from "@ac/bus";
import { query, startDatabase } from "@ac/db";
import type { EventType } from "@ac/events";
import { log } from "@ac/log";
import { createApp, registerMcp } from "@ac/mcp-kit";
import { customersTools } from "./tools.ts";

const logger = log("customers");
const PORT = Number(process.env.PORT ?? 3000);
const here = import.meta.dirname;

/** The events this service reacts to (design §12 part 2). Each name becomes one RabbitMQ binding. */
const CONSUMES: EventType[] = [];

const pool = await startDatabase({
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ac:ac@postgres:5432/customers",
  migrationsDir: path.join(here, "..", "migrations"),
  seedDir: path.join(here, "..", "seed"),
  log: logger,
});

const bus = await connectBus(process.env.AMQP_URL ?? "amqp://ac:ac@rabbitmq:5672", logger);

if (CONSUMES.length > 0) {
  await bus.consume("customers", CONSUMES, async (event) => {
    await query(
      pool,
      "INSERT INTO customers_events_seen (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [event.event_id, event.type],
    );
    logger.info({ type: event.type, event_id: event.event_id }, "event seen");
    // React here. To publish: await bus.publish(newEvent({ type: "...", payload: {...}, draft_id: event.draft_id }));
  });
}

const app = createApp();
app.get("/health", async () => ({ ok: true, service: "customers" }));
registerMcp(app, { name: "customers", tools: customersTools(pool), log: logger });

await app.listen({ port: PORT, host: "0.0.0.0" });
logger.info({ port: PORT, consumes: CONSUMES }, "customers listening; MCP on /mcp");
