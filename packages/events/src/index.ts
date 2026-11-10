import { randomUUID } from "node:crypto";
import { z } from "zod";

/** The 18 event types of design §5. The type is also the RabbitMQ routing key. */
export const EVENT_TYPES = [
  "chat.message",
  "chat.reply",
  "stock.restocked",
  "price.changed",
  "watch.matched",
  "composition.requested",
  "composition.proposed",
  "notification.requested",
  "order.confirmed",
  "address.provided",
  "shipment.quoted",
  "shipment.booked",
  "shipment.failed",
  "shipment.dispatched",
  "shipment.delivered",
  "payment.authorized",
  "payment.captured",
  "payment.failed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const money = z.number().int().nonnegative().describe("minor units, for example cents");
const sku = z.string().min(1);

/**
 * Payload schema per event type (design §5, "Main payload").
 * Phase 1 fills chat.message and chat.reply. Later phases tighten the others as they are used.
 */
export const payloads = {
  "chat.message": z.object({ text: z.string().min(1), customer_id: z.string().min(1) }),
  "chat.reply": z.object({ text: z.string().min(1), customer_id: z.string().min(1) }),
  "stock.restocked": z.object({ sku, quantity: z.number().int().positive(), price: money }),
  "price.changed": z.object({ sku, new_price: money }),
  "watch.matched": z.object({
    watch_id: z.string(),
    sku,
    available_qty: z.number().int().nonnegative(),
    price: money,
  }),
  "composition.requested": z.object({ sku, quantity: z.number().int().positive() }),
  "composition.proposed": z.object({
    items: z.array(z.object({ sku, quantity: z.number().int().positive() })),
  }),
  "notification.requested": z.object({ reason: z.string(), decision_ids: z.array(z.string()) }),
  "order.confirmed": z.object({ offer_version: z.number().int().positive() }),
  "address.provided": z.object({}),
  "shipment.quoted": z.object({ quote_id: z.string(), fee: money }),
  "shipment.booked": z.object({ tracking_id: z.string() }),
  "shipment.failed": z.object({
    reason: z.enum(["address_unresolved", "quote_mismatch", "courier_unavailable"]),
  }),
  "shipment.dispatched": z.object({ tracking_id: z.string() }),
  "shipment.delivered": z.object({ tracking_id: z.string() }),
  "payment.authorized": z.object({ authorization_id: z.string() }),
  "payment.captured": z.object({ capture_id: z.string() }),
  "payment.failed": z.object({ reason: z.enum(["declined", "unknown"]) }),
} as const satisfies Record<EventType, z.ZodObject>;

export type PayloadOf<T extends EventType> = z.infer<(typeof payloads)[T]>;

/** The seven envelope fields (landscape #11). `decision_id` is null when the producer is not an agent. */
const envelopeBase = z.object({
  event_id: z.uuid(),
  occurred_at: z.iso.datetime(),
  draft_id: z.string().nullable(),
  offer_version: z.number().int().positive().nullable(),
  decision_id: z.string().nullable(),
});

const variants = EVENT_TYPES.map((type) =>
  envelopeBase.extend({ type: z.literal(type), payload: payloads[type] }),
);

type EnvelopeBase = z.infer<typeof envelopeBase>;
type EnvelopeMap = { [T in EventType]: EnvelopeBase & { type: T; payload: PayloadOf<T> } };

/** One envelope type per event type; a discriminated union on `type`. */
export type Envelope = EnvelopeMap[EventType];
export type EnvelopeOf<T extends EventType> = EnvelopeMap[T];

// The runtime union is built from the list above; the TypeScript union is the mapped type, which keeps the discriminant.
export const EnvelopeSchema = z.discriminatedUnion(
  "type",
  variants as never,
) as unknown as z.ZodType<Envelope>;

export type NewEvent<T extends EventType> = {
  type: T;
  payload: PayloadOf<T>;
  draft_id?: string | null;
  offer_version?: number | null;
  decision_id?: string | null;
};

/** Builds a validated envelope. Throws a ZodError on a bad payload. */
export function newEvent<T extends EventType>(input: NewEvent<T>): EnvelopeOf<T> {
  const candidate = {
    event_id: randomUUID(),
    type: input.type,
    occurred_at: new Date().toISOString(),
    draft_id: input.draft_id ?? null,
    offer_version: input.offer_version ?? null,
    decision_id: input.decision_id ?? null,
    payload: input.payload,
  };
  return EnvelopeSchema.parse(candidate) as EnvelopeOf<T>;
}

/** Parses an envelope from the bus. Returns the ZodError instead of throwing. */
export function parseEnvelope(
  raw: unknown,
): { ok: true; event: Envelope } | { ok: false; error: z.ZodError } {
  const result = EnvelopeSchema.safeParse(raw);
  return result.success ? { ok: true, event: result.data } : { ok: false, error: result.error };
}

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}
