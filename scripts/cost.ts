#!/usr/bin/env node
/**
 * Cost per full order (task 5.4), from the decision records. Run it after a few success runs with the model.
 *
 *   node scripts/cost.ts
 *   PRICE_IN=4 PRICE_OUT=20 PG=localhost:55432 node scripts/cost.ts
 *
 * A completed draft has the turns of the Offer, Notification, Shipping and Payment agents on it. The Shopping
 * turn has no draft_id (the draft does not exist when the chat message arrives), so the script adds the average
 * Shopping turn. Prices are USD per million tokens; the defaults are the list prices of claude-opus-5-5
 * (4 in, 20 out) from the Anthropic pricing table as cached on 3 Nov 2026. Check them before you quote a number.
 */
import pg from "pg";

const host = process.env.PG ?? "localhost:55432";
const priceIn = Number(process.env.PRICE_IN ?? 4);
const priceOut = Number(process.env.PRICE_OUT ?? 20);

const orders = new pg.Client({ connectionString: `postgres://ac:ac@${host}/orders` });
const decisions = new pg.Client({ connectionString: `postgres://ac:ac@${host}/decisions` });
await orders.connect();
await decisions.connect();

const completed = (
  await orders.query<{ draft_id: string }>("SELECT draft_id FROM drafts WHERE state = 'completed'")
).rows.map((r) => r.draft_id);
const perDraft = await decisions.query<{
  draft_id: string;
  turns: number;
  tin: string;
  tout: string;
  model: string;
}>(
  `SELECT draft_id, count(*)::int AS turns, sum(tokens_in) AS tin, sum(tokens_out) AS tout, max(model) AS model
     FROM decision_records WHERE draft_id = ANY($1) GROUP BY draft_id`,
  [completed],
);
const shop = await decisions.query<{ n: number; tin: string; tout: string }>(
  "SELECT count(*)::int AS n, avg(tokens_in) AS tin, avg(tokens_out) AS tout FROM decision_records WHERE agent = 'shopping' AND status = 'ok'",
);
await orders.end();
await decisions.end();

const s = shop.rows[0];
const shopIn = Number(s?.tin ?? 0);
const shopOut = Number(s?.tout ?? 0);
const usd = (tin: number, tout: number) => (tin * priceIn + tout * priceOut) / 1_000_000;

if (perDraft.rows.length === 0) {
  console.log("No completed draft with decision records. Run the success path first.");
  process.exit(0);
}
console.log(
  `draft     turns  tokens in  tokens out  USD (in ${priceIn}, out ${priceOut} per MTok)`,
);
let total = 0;
for (const r of perDraft.rows) {
  const tin = Number(r.tin) + shopIn;
  const tout = Number(r.tout) + shopOut;
  const cost = usd(tin, tout);
  total += cost;
  console.log(
    `${r.draft_id.slice(0, 8)}  ${String(r.turns + 1).padStart(5)}  ${String(Math.round(tin)).padStart(9)}  ${String(Math.round(tout)).padStart(10)}  ${cost.toFixed(4)}  ${r.model}`,
  );
}
console.log(
  `average over ${perDraft.rows.length} orders: USD ${(total / perDraft.rows.length).toFixed(4)} (Shopping turn averaged over ${s?.n ?? 0} turns)`,
);
