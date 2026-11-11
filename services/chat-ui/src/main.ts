import path from "node:path";
import { connectBus } from "@ac/bus";
import { newEvent } from "@ac/events";
import { log } from "@ac/log";
import fastifyStatic from "@fastify/static";
import fastify, { type FastifyReply } from "fastify";
import { z } from "zod";

const logger = log("chat-ui");
const PORT = Number(process.env.PORT ?? 3000);
const here = import.meta.dirname;

/** Demo login (design rule 12): the list comes from the customers service. */
const CUSTOMERS_URL = process.env.CUSTOMERS_URL ?? "http://customers:3005";

const bus = await connectBus(process.env.AMQP_URL ?? "amqp://ac:ac@rabbitmq:5672", logger);

/** Open SSE streams per customer. */
const streams = new Map<string, Set<FastifyReply>>();

function push(customerId: string, data: unknown): void {
  const line = `data: ${JSON.stringify(data)}\n\n`;
  for (const reply of streams.get(customerId) ?? []) reply.raw.write(line);
}

await bus.consume("chat-ui", ["chat.reply"], async (event) => {
  if (event.type !== "chat.reply") return;
  push(event.payload.customer_id, {
    text: event.payload.text,
    event_id: event.event_id,
    decision_id: event.decision_id,
    occurred_at: event.occurred_at,
  });
});

const app = fastify({ logger: false });
await app.register(fastifyStatic, { root: path.join(here, "..", "public") });

app.get("/health", async () => ({ ok: true, service: "chat-ui" }));
app.get("/customers", async (_request, reply) => {
  try {
    const res = await fetch(`${CUSTOMERS_URL}/customers`);
    return await res.json();
  } catch (error) {
    logger.warn({ err: error }, "customers service not reachable");
    return reply.status(503).send({ error: "customers service not reachable" });
  }
});

const MessageBody = z.object({ customer_id: z.string().min(1), text: z.string().min(1).max(2000) });

app.post("/chat/messages", async (request, reply) => {
  const parsed = MessageBody.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: z.prettifyError(parsed.error) });
  const event = newEvent({ type: "chat.message", payload: parsed.data });
  await bus.publish(event);
  logger.info(
    { event_id: event.event_id, customer_id: parsed.data.customer_id },
    "chat.message published",
  );
  return { event_id: event.event_id };
});

const StreamQuery = z.object({ customer_id: z.string().min(1) });

app.get("/chat/stream", (request, reply) => {
  const parsed = StreamQuery.safeParse(request.query);
  if (!parsed.success) return reply.status(400).send({ error: "customer_id required" });
  const { customer_id } = parsed.data;
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  reply.raw.write(": connected\n\n");
  const set = streams.get(customer_id) ?? new Set<FastifyReply>();
  set.add(reply);
  streams.set(customer_id, set);
  const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    set.delete(reply);
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });
logger.info({ port: PORT }, "chat-ui listening");
