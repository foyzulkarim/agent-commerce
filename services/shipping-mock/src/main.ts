import path from "node:path";
import { connectBus } from "@ac/bus";
import { query, startDatabase } from "@ac/db";
import { newEvent } from "@ac/events";
import { log } from "@ac/log";
import { connectTool, createApp, registerMcp } from "@ac/mcp-kit";
import fastifyStatic from "@fastify/static";
import { shippingTools } from "./tools.ts";

const logger = log("shipping-mock");
const PORT = Number(process.env.PORT ?? 3004);
const here = import.meta.dirname;

const pool = await startDatabase({
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ac:ac@postgres:5432/shipping",
  migrationsDir: path.join(here, "..", "migrations"),
  log: logger,
});
const bus = await connectBus(process.env.AMQP_URL ?? "amqp://ac:ac@rabbitmq:5672", logger);
const orders = connectTool(process.env.ORDERS_MCP ?? "http://orders:3001/mcp", "shipping-mock");
const payment = connectTool(
  process.env.PAYMENT_MCP ?? "http://payment-mock:3006/mcp",
  "shipping-mock",
);

const app = createApp();
await app.register(fastifyStatic, { root: path.join(here, "..", "public") });
app.get("/health", async () => ({ ok: true, service: "shipping-mock" }));
app.get("/bookings", async () => {
  const r = await query(
    pool,
    "SELECT tracking_id, draft_id, status, created_at, updated_at FROM bookings ORDER BY created_at DESC LIMIT 50",
  );
  return r.rows;
});

/** Courier (design §3): dispatch and deliver. The shipping mock publishes the events itself. */
const move =
  (from: string, to: "dispatched" | "delivered") =>
  async (request: { params: { tracking_id: string } }, reply: import("fastify").FastifyReply) => {
    const { tracking_id } = request.params;
    const r = await query<{ draft_id: string }>(
      pool,
      `UPDATE bookings SET status = $3, updated_at = now() WHERE tracking_id = $1 AND status = $2 RETURNING draft_id`,
      [tracking_id, from, to],
    );
    const row = r.rows[0];
    if (!row)
      return reply
        .status(409)
        .send({ ok: false, message: `no booking ${tracking_id} in status ${from}` });
    const event = newEvent({
      type: to === "dispatched" ? "shipment.dispatched" : "shipment.delivered",
      payload: { tracking_id },
      draft_id: row.draft_id,
    });
    await bus.publish(event);
    logger.info(
      { tracking_id, draft_id: row.draft_id, status: to },
      `courier: ${event.type} published`,
    );
    return { ok: true, tracking_id, status: to, event_id: event.event_id };
  };
app.post<{ Params: { tracking_id: string } }>(
  "/courier/:tracking_id/dispatch",
  move("booked", "dispatched"),
);
app.post<{ Params: { tracking_id: string } }>(
  "/courier/:tracking_id/deliver",
  move("dispatched", "delivered"),
);

registerMcp(app, { name: "shipping", tools: shippingTools(pool, orders, payment), log: logger });

await app.listen({ port: PORT, host: "0.0.0.0" });
logger.info({ port: PORT }, "shipping-mock listening; courier page on /, MCP on /mcp");
