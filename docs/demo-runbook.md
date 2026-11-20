# agent-commerce: demo runbook

The show-and-tell, step by step. Each step names the page action and the same call as curl, for when a page fails.
The green numbers are the success steps of `multi-agent-design.md` §4.

## Before the room fills

1. `cd agent-commerce && bash scripts/reset.sh`: seed data only, all 15 containers up.
2. Open six tabs: chat :3000, inbox :3002, manager :3003, courier :3004, board :3001, RabbitMQ :15672 (Queues tab).
3. A terminal with `npm run logs`, filtered if needed: `npm run logs | grep -E 'EMAIL|decision|guard'`.
4. Send one test message as Dan ("what tea do you have?") to warm up the model. Then run `scripts/reset.sh` again.
5. Fallback ready: if the API fails, set `AGENT_MODE=scripted` in `.env` and run `docker compose up -d`. Say so to the room: "fixed rules now, same tools and guards". Scripted agents understand only "buy 2 coffee-1kg max 45" style text.

## Success path (Mia)

| Step | Do | Show | curl fallback |
|---|---|---|---|
| 1 | Chat as Mia: "I want 1 kg of coffee beans, max 45 dollars" | The reply: out of stock, a watch. Board: draft `waiting` | `curl -s localhost:3000/chat/messages -H 'content-type: application/json' -d '{"customer_id":"cust-mia","text":"buy 1 coffee-1kg max 45"}'` |
| 2 | Manager: restock `coffee-1kg` by 2 | RabbitMQ: `gate` gets one message. Board: watch matched, offer v1 | `curl -s localhost:3003/manager/restock -H 'content-type: application/json' -d '{"sku":"coffee-1kg","quantity":2}'` |
| 3 | Inbox as Mia | The offer email with the reason from the decision record | `curl -s 'localhost:3002/emails?customer_id=cust-mia'` |
| 4 | Click "Approve and order" | Board: `confirmed`, stock reserved | `curl -s -X POST localhost:3001/offers/<offer_id>/approve` |
| 5 | Wait 2–5 s | Board: `booked`, `authorized`. Decision records: shipping 1, payment 1, shipping 2 | — |
| 6 | Courier: Dispatch | RabbitMQ: `shipment.dispatched` to two queues | `curl -s -X POST localhost:3004/courier/<tracking_id>/dispatch` |
| 7 | Wait | Payment `captured`; "on its way" email | — |
| 8 | Courier: Deliver | — | `curl -s -X POST localhost:3004/courier/<tracking_id>/deliver` |
| 9 | Wait | Board: `completed`; "delivered" email; 9 agent turns in total | — |

Point at: the Offer agent chose SKUs; code set the prices (`propose_offer`). The payment amount never passed through an agent (`authorize` reads the offer total).

## Failure paths (pick two)

| Customer and text | What the room sees |
|---|---|
| Nora: "buy 1 tea" | Approve. Shipping cannot geocode: the address question email with a form. Send "5 Swanston St, Melbourne 3000". Booked |
| Leo: "buy 1 tea" | Approve. The quote is AUD 25.00, the offer said 10.00: `quote_mismatch`, offer version 2 with the new fee. Approve again |
| Mia: "buy 1 kettle" | No courier. Each approve gives a new offer and a void. After version 3: cancelled, email |
| Dan: "buy 1 tea" | Approve. The card is declined: `failed`, email, nothing charged |
| Mia: "buy 2 bags of 1 kg coffee" with 1 in stock | The Offer agent asks the Inventory agent; the offer is 1 x 1 kg + 2 x 500 g |
| Board: "Tick +120 min" | Every open offer and watch expires; the expiry emails |

To prepare stock without an event: `curl -s localhost:3003/manager/stock -H 'content-type: application/json' -d '{"sku":"coffee-1kg","quantity":1}'` (sets the units free to sell).

## Add a service, live

```sh
node scripts/new-service.ts loyalty --consumes shipment.delivered --port 3007
```

Show the one new compose entry and the queue `loyalty` bound to `shipment.delivered` in RabbitMQ. The full worked example, with the points email: `git apply examples/loyalty.patch`.

## After the demo

`bash scripts/reset.sh` before the participants start.
