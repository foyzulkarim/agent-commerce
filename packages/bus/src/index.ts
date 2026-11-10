import { type Envelope, type EventType, parseEnvelope } from "@ac/events";
import type { Logger } from "@ac/log";
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";

export const EXCHANGE = "events";
export const DEAD_LETTERS = "dead-letters";

export type Handler = (event: Envelope) => Promise<void>;

type Consumer = { queue: string; bindings: readonly EventType[]; handler: Handler };

export type Bus = {
  publish: (event: Envelope) => Promise<void>;
  /**
   * Declares `queue`, binds it to each routing key, and runs `handler` per message with prefetch 1
   * and manual ack. A handler that throws sends the message to `dead-letters` (landscape #14).
   */
  consume: (queue: string, bindings: readonly EventType[], handler: Handler) => Promise<void>;
  close: () => Promise<void>;
};

/** Connects with amqplib's built-in recovery. On reconnect, the topology and consumers are set up again. */
export async function connectBus(url: string, log: Logger): Promise<Bus> {
  const consumers: Consumer[] = [];
  let channel: Channel | undefined;

  async function attach(ch: Channel, consumer: Consumer): Promise<void> {
    const { queue, bindings } = consumer;
    await ch.assertQueue(queue, {
      durable: true,
      deadLetterExchange: "",
      deadLetterRoutingKey: DEAD_LETTERS,
    });
    for (const key of bindings) await ch.bindQueue(queue, EXCHANGE, key);
    await ch.consume(queue, (message) => void handle(ch, consumer, message), { noAck: false });
    log.info({ queue, bindings }, "consuming");
  }

  async function handle(
    ch: Channel,
    consumer: Consumer,
    message: ConsumeMessage | null,
  ): Promise<void> {
    if (!message) return;
    let raw: unknown;
    try {
      raw = JSON.parse(message.content.toString("utf8"));
    } catch {
      log.error({ queue: consumer.queue }, "message is not JSON; dead-lettered");
      ch.nack(message, false, false);
      return;
    }
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) {
      log.error(
        { queue: consumer.queue, issues: parsed.error.issues },
        "bad envelope; dead-lettered",
      );
      ch.nack(message, false, false);
      return;
    }
    try {
      await consumer.handler(parsed.event);
      ch.ack(message);
    } catch (error) {
      log.error(
        { err: error, event_id: parsed.event.event_id, type: parsed.event.type },
        "handler failed; dead-lettered",
      );
      ch.nack(message, false, false);
    }
  }

  async function setup(model: ChannelModel): Promise<void> {
    const ch = await model.createChannel();
    await ch.prefetch(1);
    await ch.assertExchange(EXCHANGE, "topic", { durable: true });
    await ch.assertQueue(DEAD_LETTERS, { durable: true });
    for (const consumer of consumers) await attach(ch, consumer);
    channel = ch;
  }

  const model = await amqp.connect(url, {
    recovery: { setup, initialDelay: 500, maxDelay: 10_000 },
  });
  model.on("error", (error: Error) => log.error({ err: error }, "connection error"));
  model.on("reconnect-scheduled", () => log.warn("broker lost; reconnect scheduled"));
  log.info("bus connected");

  function current(): Channel {
    if (!channel) throw new Error("bus channel not ready");
    return channel;
  }

  return {
    async publish(event) {
      current().publish(EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: "application/json",
        messageId: event.event_id,
        type: event.type,
        timestamp: Math.floor(Date.parse(event.occurred_at) / 1000),
      });
      log.debug({ type: event.type, event_id: event.event_id }, "published");
    },
    async consume(queue, bindings, handler) {
      const consumer: Consumer = { queue, bindings, handler };
      consumers.push(consumer);
      await attach(current(), consumer);
    },
    async close() {
      await model.close();
    },
  };
}
