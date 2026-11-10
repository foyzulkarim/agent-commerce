import assert from "node:assert/strict";
import { test } from "node:test";
import { type Envelope, newEvent } from "@ac/events";
import { log } from "@ac/log";
import { connectBus } from "./index.ts";

const AMQP_URL = process.env.AMQP_URL;

test("publish reaches a bound queue; a throwing handler dead-letters", {
  skip: !AMQP_URL && "set AMQP_URL",
}, async () => {
  const bus = await connectBus(AMQP_URL as string, log("bus-test"));
  const queue = `test-${Date.now()}`;
  const received: Envelope[] = [];
  let attempts = 0;
  await bus.consume(queue, ["chat.reply"], async (event) => {
    attempts += 1;
    if (event.type === "chat.reply" && event.payload.text === "boom") throw new Error("boom");
    received.push(event);
  });
  await bus.publish(
    newEvent({ type: "chat.reply", payload: { text: "hello", customer_id: "c1" } }),
  );
  await bus.publish(newEvent({ type: "chat.reply", payload: { text: "boom", customer_id: "c1" } }));
  await bus.publish(
    newEvent({ type: "chat.message", payload: { text: "not bound", customer_id: "c1" } }),
  );
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(received.length, 1);
  assert.equal(attempts, 2);
  await bus.close();
});
