import path from "node:path";
import { connectBus } from "@ac/bus";
import { query, startDatabase, withTransaction } from "@ac/db";
import { newEvent } from "@ac/events";
import { log } from "@ac/log";
import { createApp, registerMcp } from "@ac/mcp-kit";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { getProducts, listProducts } from "./catalogue.ts";
import { catalogueTools } from "./tools.ts";

const logger = log("catalogue-mock");
const PORT = Number(process.env.PORT ?? 3003);
const here = import.meta.dirname;

const pool = await startDatabase({
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ac:ac@postgres:5432/catalogue",
  migrationsDir: path.join(here, "..", "migrations"),
  seedDir: path.join(here, "..", "seed"),
  log: logger,
});
const bus = await connectBus(process.env.AMQP_URL ?? "amqp://ac:ac@rabbitmq:5672", logger);

const app = createApp();
await app.register(fastifyStatic, { root: path.join(here, "..", "public") });
app.get("/health", async () => ({ ok: true, service: "catalogue-mock" }));
app.get("/products", async () => listProducts(pool));

const Restock = z.object({ sku: z.string().min(1), quantity: z.coerce.number().int().positive() });
const Price = z.object({ sku: z.string().min(1), price: z.coerce.number().int().nonnegative() });

/** Shop manager: add stock, then publish stock.restocked (design §3). */
app.post("/manager/restock", async (request, reply) => {
  const body = Restock.safeParse(request.body);
  if (!body.success) return reply.status(400).send({ error: z.prettifyError(body.error) });
  const { sku, quantity } = body.data;
  const updated = await withTransaction(pool, async (tx) => {
    const r = await query(tx, "UPDATE stock SET quantity = quantity + $2 WHERE sku = $1", [
      sku,
      quantity,
    ]);
    return r.rowCount;
  });
  if (!updated) return reply.status(404).send({ error: `unknown SKU ${sku}` });
  const [product] = await getProducts(pool, [sku]);
  if (!product) return reply.status(404).send({ error: `unknown SKU ${sku}` });
  const event = newEvent({
    type: "stock.restocked",
    payload: { sku, quantity, available_qty: product.available, price: product.unit_price },
  });
  await bus.publish(event);
  logger.info(
    { sku, quantity, available: product.available },
    "restocked; stock.restocked published",
  );
  return { product, event_id: event.event_id };
});

/** Shop manager: change the price, then publish price.changed. Offers keep their price (design §10 item 13). */
app.post("/manager/price", async (request, reply) => {
  const body = Price.safeParse(request.body);
  if (!body.success) return reply.status(400).send({ error: z.prettifyError(body.error) });
  const { sku, price } = body.data;
  const r = await query(pool, "UPDATE products SET unit_price = $2 WHERE sku = $1", [sku, price]);
  if (!r.rowCount) return reply.status(404).send({ error: `unknown SKU ${sku}` });
  const [product] = await getProducts(pool, [sku]);
  if (!product) return reply.status(404).send({ error: `unknown SKU ${sku}` });
  const event = newEvent({
    type: "price.changed",
    payload: { sku, new_price: price, available_qty: product.available },
  });
  await bus.publish(event);
  logger.info({ sku, price }, "price changed; price.changed published");
  return { product, event_id: event.event_id };
});

/**
 * Demo helper: set the units free to sell, without an event (to prepare a scenario).
 * Reservations of approved offers stay; the stock becomes quantity + reserved.
 */
app.post("/manager/stock", async (request, reply) => {
  const body = z
    .object({ sku: z.string().min(1), quantity: z.coerce.number().int().nonnegative() })
    .safeParse(request.body);
  if (!body.success) return reply.status(400).send({ error: z.prettifyError(body.error) });
  await query(
    pool,
    `UPDATE stock SET quantity = $2 + COALESCE((SELECT sum(quantity) FROM reservations WHERE sku = $1), 0)
      WHERE sku = $1`,
    [body.data.sku, body.data.quantity],
  );
  const [product] = await getProducts(pool, [body.data.sku]);
  return { product };
});

registerMcp(app, { name: "catalogue", tools: catalogueTools(pool), log: logger });

await app.listen({ port: PORT, host: "0.0.0.0" });
logger.info({ port: PORT }, "catalogue-mock listening; manager page on /, MCP on /mcp");
