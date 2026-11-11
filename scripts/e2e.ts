#!/usr/bin/env node
/**
 * End-to-end scenarios over plain HTTP: the same calls a page or curl makes.
 * Runs against `docker compose up` or `scripts/dev-host.sh`, with scripted agents or with the model.
 *
 *   node scripts/e2e.ts                 all scenarios
 *   node scripts/e2e.ts success address one or more by name
 *
 * The scenarios change stock levels. Run them on a demo database, not during a live demo.
 * The timer scenarios move the clock forward and expire every open offer and watch; they run last.
 */
const URL = {
  chat: process.env.CHAT_URL ?? "http://127.0.0.1:3000",
  orders: process.env.ORDERS_URL ?? "http://127.0.0.1:3001",
  email: process.env.EMAIL_URL ?? "http://127.0.0.1:3002",
  catalogue: process.env.CATALOGUE_URL ?? "http://127.0.0.1:3003",
  shipping: process.env.SHIPPING_URL ?? "http://127.0.0.1:3004",
  rabbit: process.env.RABBIT_API ?? "http://127.0.0.1:15672",
};
const WAIT_MS = Number(process.env.E2E_WAIT_MS ?? 30_000);

type Offer = {
  offer_id: string;
  version: number;
  status: string;
  total: number;
  shipping_fee: number;
  items: { sku: string; quantity: number }[];
};
type Draft = {
  draft_id: string;
  customer_id: string;
  sku: string;
  state: string;
  delivery_status: string | null;
  payment_status: string | null;
  offer: Offer | null;
  offers: Offer[];
  watch: { status: string } | null;
  decisions: { agent: string; status: string; event_type: string }[];
};
type Email = { reason: string; draft_id: string; subject: string };

async function http(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  // biome-ignore lint/suspicious/noExplicitAny: test helper over many JSON shapes
  return { status: res.status, data: data as any };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
): Promise<T> {
  const until = Date.now() + WAIT_MS;
  let last: unknown;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (error) {
      last = error;
    }
    await sleep(400);
  }
  throw new Error(`timeout: ${what}${last ? ` (${(last as Error).message})` : ""}`);
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`check failed: ${message}`);
}

const draftsOf = async (customer: string) =>
  (await http("GET", `${URL.orders}/drafts?customer_id=${customer}`)).data as {
    draft_id: string;
  }[];
const draft = async (id: string) => (await http("GET", `${URL.orders}/drafts/${id}`)).data as Draft;
const emailsOf = async (customer: string) =>
  (await http("GET", `${URL.email}/emails?customer_id=${customer}`)).data as Email[];
const setStock = (sku: string, quantity: number) =>
  http("POST", `${URL.catalogue}/manager/stock`, { sku, quantity });
const restock = (sku: string, quantity: number) =>
  http("POST", `${URL.catalogue}/manager/restock`, { sku, quantity });
const approve = (offer: Offer) => http("POST", `${URL.orders}/offers/${offer.offer_id}/approve`);

async function chat(customer: string, text: string): Promise<string> {
  const before = new Set((await draftsOf(customer)).map((d) => d.draft_id));
  const r = await http("POST", `${URL.chat}/chat/messages`, { customer_id: customer, text });
  check(r.status === 200, `chat accepted (${r.status})`);
  const created = await waitFor(`a new draft for ${customer}`, async () =>
    (await draftsOf(customer)).find((d) => !before.has(d.draft_id)),
  );
  return created.draft_id;
}

async function until(id: string, what: string, pred: (d: Draft) => boolean): Promise<Draft> {
  return waitFor(`${what} (draft ${id.slice(0, 8)})`, async () => {
    const d = await draft(id);
    return pred(d) ? d : undefined;
  });
}

async function emailFor(customer: string, id: string, reason: string, count = 1): Promise<Email[]> {
  return waitFor(`${count} x ${reason} email`, async () => {
    const list = (await emailsOf(customer)).filter((e) => e.draft_id === id && e.reason === reason);
    return list.length >= count ? list : undefined;
  });
}

/** Approves the open offer and waits until the shipment is booked. */
async function approveAndBook(id: string): Promise<Draft> {
  const d = await until(id, "offered", (x) => x.state === "offered" && x.offer?.status === "open");
  const r = await approve(d.offer as Offer);
  check(r.status === 200, `approve accepted (${r.status} ${JSON.stringify(r.data)})`);
  return until(
    id,
    "booked and authorized",
    (x) => x.delivery_status === "booked" && x.payment_status === "authorized",
  );
}

async function trackingOf(id: string): Promise<string> {
  return waitFor("a booking", async () => {
    const list = (await http("GET", `${URL.shipping}/bookings`)).data as {
      draft_id: string;
      tracking_id: string;
    }[];
    return list.find((b) => b.draft_id === id)?.tracking_id;
  });
}

/** Reads the chat reply over SSE while `act` runs. */
async function chatReply(customer: string, act: () => Promise<void>): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(`${URL.chat}/chat/stream?customer_id=${customer}`, {
    signal: controller.signal,
  });
  const reader = res.body?.getReader();
  check(reader, "SSE stream");
  const decoder = new TextDecoder();
  let buffer = "";
  const reply = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return "";
      buffer += decoder.decode(value);
      const m = /data: (.+)\n\n/.exec(buffer);
      if (m?.[1]) return JSON.parse(m[1]).text as string;
    }
  })();
  await act();
  const text = await Promise.race([reply, sleep(WAIT_MS).then(() => "")]);
  controller.abort();
  return text;
}

const scenarios: Record<string, () => Promise<string>> = {
  async success() {
    await setStock("coffee-1kg", 0);
    let id = "";
    const reply = await chatReply("cust-mia", async () => {
      id = await chat("cust-mia", "buy 1 coffee-1kg max 45");
    });
    check(reply.length > 0, "a chat reply by SSE");
    let d = await until(
      id,
      "waiting with a watch",
      (x) => x.state === "waiting" && x.watch?.status === "open",
    );
    await restock("coffee-1kg", 2);
    d = await until(id, "offer v1", (x) => x.state === "offered");
    check(d.offer?.total === 3800 + 1000, `total 48.00 (got ${d.offer?.total})`);
    await emailFor("cust-mia", id, "offer_ready");
    await approveAndBook(id);
    const tracking = await trackingOf(id);
    check(
      (await http("POST", `${URL.shipping}/courier/${tracking}/dispatch`)).status === 200,
      "dispatch",
    );
    await until(
      id,
      "dispatched and captured",
      (x) => x.delivery_status === "dispatched" && x.payment_status === "captured",
    );
    check(
      (await http("POST", `${URL.shipping}/courier/${tracking}/deliver`)).status === 200,
      "deliver",
    );
    d = await until(id, "completed", (x) => x.state === "completed");
    await emailFor("cust-mia", id, "order_delivered");
    await emailFor("cust-mia", id, "order_dispatched");
    d = await draft(id);
    const ok = d.decisions.filter((r) => r.status === "ok");
    check(ok.length >= 8, `at least 8 ok decision records on the draft (got ${ok.length})`);
    return `reply "${reply.slice(0, 50)}…", ${d.decisions.length} decision records, tracking ${tracking}`;
  },

  async reject() {
    const id = await chat("cust-mia", "buy 1 tea-250g");
    const d = await until(id, "offered at once (in stock)", (x) => x.state === "offered");
    const r = await http("POST", `${URL.orders}/offers/${d.offer?.offer_id}/reject`);
    check(r.status === 200, "reject accepted");
    await until(id, "rejected", (x) => x.state === "rejected");
    return "in stock → offered → rejected";
  },

  async soldout() {
    await setStock("coffee-500g", 1);
    const id = await chat("cust-mia", "buy 1 coffee-500g");
    const d = await until(id, "offered", (x) => x.state === "offered");
    await setStock("coffee-500g", 0);
    const r = await approve(d.offer as Offer);
    check(r.status === 409, `approve answers 409 sold out (got ${r.status})`);
    await until(
      id,
      "waiting again with a watch",
      (x) => x.state === "waiting" && x.watch?.status === "open",
    );
    await setStock("coffee-500g", 10);
    return "approve with no stock → waiting with a new watch";
  },

  async address() {
    const id = await chat("cust-nora", "buy 1 tea-250g");
    let d = await until(id, "offered", (x) => x.state === "offered");
    check((await approve(d.offer as Offer)).status === 200, "approve");
    d = await until(id, "address pending", (x) => x.delivery_status === "address_pending");
    await emailFor("cust-nora", id, "address_question");
    const r = await http("POST", `${URL.orders}/drafts/${id}/address`, {
      line1: "5 Swanston St",
      city: "Melbourne",
      postcode: "3000",
    });
    check(r.status === 200, `address accepted (${r.status})`);
    d = await until(id, "booked after the new address", (x) => x.delivery_status === "booked");
    return "address_unresolved → question email → form → booked";
  },

  async quote() {
    const id = await chat("cust-leo", "buy 1 tea-250g");
    let d = await until(id, "offered", (x) => x.state === "offered");
    check(d.offer?.shipping_fee === 1000, "v1 has the default fee");
    check((await approve(d.offer as Offer)).status === 200, "approve v1");
    d = await until(id, "offer v2", (x) => x.state === "offered" && x.offer?.version === 2);
    check(d.offer?.shipping_fee === 2500, `v2 has the remote fee (got ${d.offer?.shipping_fee})`);
    await emailFor("cust-leo", id, "offer_ready", 2);
    await approveAndBook(id);
    return "quote_mismatch → offer v2 with fee 25.00 → approved → booked";
  },

  async courier() {
    const id = await chat("cust-mia", "buy 1 kettle");
    for (let v = 1; v <= 3; v++) {
      const d = await until(
        id,
        `offer v${v}`,
        (x) => x.state === "offered" && x.offer?.version === v,
      );
      check((await approve(d.offer as Offer)).status === 200, `approve v${v}`);
      if (v < 3)
        await until(
          id,
          `offer v${v + 1} after courier_unavailable`,
          (x) => (x.offer?.version ?? 0) > v,
        );
    }
    await until(id, "cancelled at the version limit", (x) => x.state === "cancelled");
    await emailFor("cust-mia", id, "order_cancelled");
    const auths = (
      await http("GET", "http://127.0.0.1:3006/authorizations").catch(() => ({ data: [] }))
    ).data as { draft_id: string; status: string }[];
    const mine = Array.isArray(auths) ? auths.filter((a) => a.draft_id === id) : [];
    if (mine.length)
      check(
        mine.every((a) => a.status === "voided"),
        `all authorizations voided (${mine.map((a) => a.status)})`,
      );
    return `3 offers, courier_unavailable each time, cancelled; ${mine.length || "?"} authorizations voided`;
  },

  async declined() {
    const id = await chat("cust-dan", "buy 1 tea-250g");
    const d = await until(id, "offered", (x) => x.state === "offered");
    check((await approve(d.offer as Offer)).status === 200, "approve");
    await until(id, "failed", (x) => x.state === "failed");
    await emailFor("cust-dan", id, "payment_failed");
    return "card declined → failed → email";
  },

  async unknown() {
    const id = await chat("cust-ivy", "buy 1 tea-250g");
    const d = await until(id, "offered", (x) => x.state === "offered");
    check((await approve(d.offer as Offer)).status === 200, "approve");
    await until(id, "failed", (x) => x.state === "failed");
    return "payment unknown after 3 queries → failed";
  },

  async composition() {
    await setStock("coffee-1kg", 0);
    await setStock("coffee-500g", 10);
    const id = await chat("cust-mia", "buy 2 coffee-1kg max 45");
    await until(id, "waiting", (x) => x.state === "waiting" && x.watch?.status === "open");
    await restock("coffee-1kg", 1);
    const d = await until(id, "offer with a composition", (x) => x.state === "offered");
    const items = d.offer?.items.map((i) => `${i.quantity}x${i.sku}`).join(" + ");
    check(
      d.offer?.items.some((i) => i.sku === "coffee-500g"),
      `offer contains coffee-500g (got ${items})`,
    );
    return `1 kg in stock, 2 wanted → offer ${items}`;
  },

  async deadletter() {
    const before = await deadLetters();
    await http("POST", `${URL.chat}/chat/messages`, {
      customer_id: "cust-ghost",
      text: "buy 1 tea-250g",
    });
    if (before === null) return "skipped the count: RabbitMQ management API not reachable";
    await waitFor("one more dead letter", async () => ((await deadLetters()) ?? 0) > before);
    return "unknown customer → guard refuses → turn error → dead-letters";
  },

  async timer() {
    const offered = await chat("cust-mia", "buy 1 tea-250g");
    await until(offered, "offered", (x) => x.state === "offered");
    await setStock("coffee-1kg", 0);
    const waiting = await chat("cust-mia", "buy 1 coffee-1kg");
    await until(waiting, "waiting", (x) => x.state === "waiting" && x.watch?.status === "open");
    const r = await http("POST", `${URL.orders}/timer/tick`, { advance_minutes: 24 * 60 });
    check(r.status === 200, "tick");
    await until(offered, "offer expired", (x) => x.state === "expired");
    await until(waiting, "watch expired", (x) => x.state === "expired");
    await emailFor("cust-mia", offered, "offer_expired");
    await emailFor("cust-mia", waiting, "watch_expired");
    return `tick +24 h expired ${JSON.stringify(r.data.expired)}`;
  },
};

async function deadLetters(): Promise<number | null> {
  try {
    const res = await fetch(`${URL.rabbit}/api/queues/%2F/dead-letters`, {
      headers: { authorization: `Basic ${Buffer.from("ac:ac").toString("base64")}` },
    });
    if (!res.ok) return null;
    const q = (await res.json()) as { messages?: number };
    return q.messages ?? 0;
  } catch {
    return null;
  }
}

const order = [
  "success",
  "reject",
  "soldout",
  "address",
  "quote",
  "courier",
  "declined",
  "unknown",
  "composition",
  "deadletter",
  "timer",
];
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : order;
let failed = 0;
for (const name of chosen) {
  const run = scenarios[name];
  if (!run) {
    console.log(`? ${name}: unknown scenario (${order.join(", ")})`);
    failed += 1;
    continue;
  }
  const started = Date.now();
  try {
    const note = await run();
    console.log(`✔ ${name} (${((Date.now() - started) / 1000).toFixed(1)} s): ${note}`);
  } catch (error) {
    failed += 1;
    console.log(
      `✖ ${name} (${((Date.now() - started) / 1000).toFixed(1)} s): ${(error as Error).message}`,
    );
  }
}
console.log(failed ? `${failed} scenario(s) failed` : "all scenarios passed");
process.exit(failed ? 1 : 0);
