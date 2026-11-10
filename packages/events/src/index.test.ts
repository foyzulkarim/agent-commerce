import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_TYPES, isEventType, newEvent, parseEnvelope } from "./index.ts";

test("there are 18 event types", () => {
  assert.equal(EVENT_TYPES.length, 18);
  assert.equal(new Set(EVENT_TYPES).size, 18);
});

test("newEvent fills the seven envelope fields", () => {
  const event = newEvent({ type: "chat.message", payload: { text: "hi", customer_id: "c1" } });
  assert.deepEqual(Object.keys(event).sort(), [
    "decision_id",
    "draft_id",
    "event_id",
    "occurred_at",
    "offer_version",
    "payload",
    "type",
  ]);
  assert.equal(event.decision_id, null);
  assert.equal(event.draft_id, null);
});

test("newEvent rejects a payload that misses a field", () => {
  assert.throws(() => newEvent({ type: "chat.reply", payload: { text: "x" } as never }));
});

test("parseEnvelope round-trips and rejects an unknown type", () => {
  const event = newEvent({
    type: "shipment.failed",
    payload: { reason: "quote_mismatch" },
    draft_id: "d1",
  });
  const parsed = parseEnvelope(JSON.parse(JSON.stringify(event)));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.event, event);
  const bad = parseEnvelope({ ...event, type: "order.exploded" });
  assert.equal(bad.ok, false);
  assert.equal(isEventType("order.exploded"), false);
});
