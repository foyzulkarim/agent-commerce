# agent-commerce: work plan for the v7 build

Status: proposal, 10 Nov 2026. Inputs: `handoff-note.md`, `multi-agent-design.md` (v7), `technical-landscape.md`, the two v7 diagrams, `../debrief/agent-commerce-deck.html`.

## 1. Answer in short

Build the v7 blueprint in six phases. Each phase ends with something you can show.

| Phase | Name | What you can show at the end | Tasks |
|---|---|---|---|
| 0 | Decide and close gaps | Design v7.1: the five gaps in §3 are closed, versions are pinned | 11 |
| 1 | Skeleton | `docker compose up` starts 15 containers. One chat message gets one reply. The 9 thin-path checks pass | 8 |
| 2 | From question to offer | Mia asks, waits, the manager restocks, an offer email appears in the inbox (success steps 1–3) | 7 |
| 3 | From approval to delivery | Mia approves. Shipping, payment and the courier complete the order (success steps 4–9) | 6 |
| 4 | Other paths and limits | Every transition in design §8 and every limit in §9 runs from a curl script | 8 |
| 5 | Workshop readiness | A participant adds a service with the generator. The demo runs on a clean machine | 7 |

Total: 47 tasks. Phase 0 needs your decisions. Phases 1–5 are build work for agents, with one check per task.

The order follows two rules from the handoff note: skeleton first, and each stage testable. Phases 2–4 cut the order flow into three slices that each add a demonstrable piece. This matches the "build order" rule in `agent-requirements.md` §8: a step that cannot be shown is not finished.

## 2. The full work

This section lists every unit the v7 design asks for. It is the inventory that the phases divide.

| Unit | Count | Items | Design source |
|---|---|---|---|
| Root files | 9 | `package.json`, `.npmrc`, `biome.json`, `tsconfig.base.json`, `compose.yaml`, `Dockerfile`, `.env.example`, `scripts/new-service.ts`, `scripts/check.sh` | landscape §6 |
| Templates | 2 | `_template-service`, `_template-agent` | landscape §6 |
| Shared packages | 7 | `events`, `bus`, `db`, `decisions`, `mcp-kit`, `log`, `agent-runtime` | design §14 |
| Services | 7 | `chat-ui`, `orders`, `customers`, `email`, `catalogue-mock`, `shipping-mock`, `payment-mock` | design §14 |
| Agents | 6 | `shopping`, `offer`, `inventory`, `notification`, `shipping`, `payment` | design §14 |
| Infrastructure containers | 2 | `postgres`, `rabbitmq` | design §14 |
| Databases | 7 | `orders`, `customers`, `email`, `catalogue`, `shipping`, `payment`, `decisions` | design §14 |
| Tables | 15 | drafts, offers, stock_watches, outbox, dropped_events, customers, addresses, emails, products, stock, reservations, quotes, bookings, authorizations, decision_records | design §14 |
| Event types | 18 | design §5 table | design §5 |
| Envelope fields | 7 | `event_id`, `type`, `occurred_at`, `draft_id`, `offer_version`, `decision_id`, `payload` | design §5, landscape #11 |
| MCP tools | 13 | orders 3, customers 2, catalogue 1, email 1, shipping 3, payment 3 | design §6 |
| Local agent tools | 2 | `emit_event`, `done` | landscape §8 |
| Plain-code reactors | 4 | Gate, Status updater, Outbox relay, Timer | design §2, §5 |
| HTTP endpoints | 10 | chat message, approve, reject, address, restock, price, dispatch, deliver, timer tick, plus the SSE stream for chat | design §3 |
| Pages | 4 | chat, inbox, manager, courier | design §2 |
| Queues | 10 | 9 consumer queues and `dead-letters` | design §14 |
| Notification reasons | 8 | `offer_ready`, `offer_expired`, `watch_expired`, `order_cancelled`, `address_question`, `order_dispatched`, `order_delivered`, `payment_failed` | design §5 |
| Draft states | 8 | waiting, offered, confirmed, rejected, expired, cancelled, failed, completed | design §8 |
| Thin-path checks | 9 | landscape §9 | landscape §9 |
| Workshop material | 5 | README, CONTRIBUTING, demo runbook, participant checklist, deck update | handoff §1, deck |

## 3. Gaps the code cannot leave open

I read the design as a builder. The five items below have no answer in the documents. Each needs one decision before Phase 1 or Phase 2. I give a recommendation for each. The recommendation is my guess, not a fact.

| # | Gap | Where it blocks | Options | Recommendation |
|---|---|---|---|---|
| G1 | The Shopping agent must turn "1 kg of coffee beans" into a SKU. The Inventory agent must find "other SKUs that meet the same need". The catalogue MCP server has only `reserve_stock` (design §6). No tool reads the catalogue | Phase 2 | (a) add `search_products` and `get_product` to the catalogue server. (b) put the whole catalogue in the agent prompt | (a). It keeps the prompt small and shows a read tool next to a guarded tool. Adds one row in §6 and one edge in the flow view |
| G2 | The Notification agent reads decision records (flow edge e14) and must describe the offer. The documents do not say how it reads them | Phase 2 | (a) local tool `read_decisions(decision_ids)` in `agent-runtime`. (b) the outbox copies decision text into the `notification.requested` payload | (a). It keeps rule 6: emails explain decisions only from records. (b) duplicates data |
| G3 | The shipping server "uses the draft address". The payment server takes "amount = approved offer total". Both live in other containers than the orders DB. Nothing in §6 lets them read a draft | Phase 3 | (a) read-only tool `get_draft` on the orders server, called by the shipping and payment servers as MCP clients. (b) the events carry address and amount | (a). (b) breaks rule 2 in spirit: the amount would pass through an agent's event |
| G4 | The Gate matches a watch when the price is at or under `max_price` (design §10 item 13). `stock.restocked` carries `sku` and `quantity`, not the price | Phase 2 | (a) add `price` to the `stock.restocked` payload. (b) the Gate calls the catalogue server | (a). One field, no cross-container call in plain code |
| G5 | `chat.reply` carries only `text`. The chat-ui container must route it to one browser. `draft_id` is null before a draft exists | Phase 1 | (a) add `customer_id` to the `chat.reply` payload; chat-ui keeps one SSE stream per customer. (b) add a `message_id` and echo it | (a). The page already selects a customer at demo login |

Two more items need a rule, not a design change:

| # | Item | Why | Recommendation |
|---|---|---|---|
| G6 | Fault triggers in the mocks. The demo must make geocode fail, a courier be unavailable, and a payment decline or return unknown, on purpose | Phase 4 | Deterministic rules in seed data, for example a street name that geocode rejects, and a card reference per customer that declines. No random faults |
| G7 | Table columns per database. The landscape says "columns later, one service at a time" | Phases 2–4 | Keep that rule. Each service task below proposes its columns as a short diff to design §14 before the code |

## 4. Facts checked on 10 Nov 2026 in this session

| Fact | Result | Effect on the plan |
|---|---|---|
| `rabbitmq:4.4-management` tag on Docker Hub | Exists (HTTP 200 from the Hub tag API). `4.3-management` also exists | Close the open item. Use 4.4 |
| Node 26 latest | 26.13.0, bundles npm 11.20.0 | Matches the landscape |
| Type stripping of a `.ts` file | Works on Node 22.23 without a flag | Workspace symlink question still open; check in task 1.2 |
| Docker in this cloud session | Not available | Compose checks run on your machine or in CI (task 1.8) |

Library versions on npm today against the landscape §4:

| Library | Landscape | npm today | Note |
|---|---|---|---|
| `@anthropic-ai/sdk` | 1.4.0 | 1.8.0 | Pin after `min-release-age` |
| `@modelcontextprotocol/server`, `/client` | 2.0.0 | 2.4.0 | Four minor releases since July. Read the changelog in task 0.8 |
| `@modelcontextprotocol/fastify` | 2.0.0 | 2.0.1 | — |
| `amqplib` | 2.2.0 | 2.3.1 | — |
| `zod` | 4.6.7 | 4.6.7 | Same |
| `pg` | 8.x | 8.23.1 | — |
| `fastify` | 5.8.5 | 5.12.8 | — |
| `@fastify/static` | 8.1.x | 10.1.10 | **Two major versions.** Check the Fastify 5 peer range |
| `pino` | 10.4.0 | 10.4.0 | Same |
| `pino-pretty` | 13.1.3 | 13.2.0 | — |
| `@biomejs/biome` | 2.6 | 2.6.6 | — |
| `typescript` | 6.x | 7.0.2 | **TypeScript 7 is the native (Go) compiler.** Decide 6 or 7 in task 0.8 |

## 5. Phase 0: decide and close gaps

No code. Output: design v7.1 and landscape updates, one section per turn, as diffs. Diagrams regenerated if an edge changes.

Result (10 Nov 2026): G1 to G6 and the handoff open items are decided and written into `multi-agent-design.md` §5, §6 and §14 and `technical-landscape.md` §4 and §8. TypeScript stays on 6. The code lives in `agent-commerce/` in this repo (0.1). The three new tool edges are not drawn yet; see design §14. Task 1.8 (CI) is left out until needed.

| Task | Decide | Output |
|---|---|---|
| 0.1 | Where the code lives: `agent-commerce/` directory in this repo, or a new repo. Recommendation: this repo now, under `agent-commerce/`. The root `package.json` for the decks stays. Split later with `git subtree split` if the workshop needs a clean clone | One line in `docs/README.md` |
| 0.2 | G1: catalogue read tools | Design §6 row; flow view edge e35 |
| 0.3 | G2: how the Notification agent reads decisions | Landscape §8 local tools list |
| 0.4 | G3: `get_draft` on the orders server | Design §6 row |
| 0.5 | G4: `price` in `stock.restocked` | Design §5 row |
| 0.6 | G5: `customer_id` in `chat.reply` | Design §5 row |
| 0.7 | The handoff §6 open items: dead-letter mechanism (`x-dead-letter-exchange` on each consumer queue), composition meaning, Shipping and Payment as agents, endpoint paths. Recommendation: accept all four as written | Design §14 and §3 |
| 0.8 | Version pins. Run `npm view` for each library under `min-release-age=7`. Decide TypeScript 6 or 7. Decide `@fastify/static` 10 | Landscape §4 |
| 0.9 | G6: fault triggers in the mocks | Design §6, one line per mock |
| 0.10 | Seed data: the customers (Mia and two more), the products (coffee beans 1 kg and 500 g, and two more), the addresses, the fault triggers | A seed table in design §14 |
| 0.11 | The build process: one PR per phase, one commit per task, each task's check in the PR text | `CONTRIBUTING.md` draft |

## 6. Phase 1: skeleton

Goal: the thin path. The stages a–f come from the handoff note §7. Task 1.8 is new.

Result (10 Nov 2026): tasks 1.1 to 1.7 are built in `agent-commerce/`. Checks that ran in the cloud session, against a local Postgres 16 and RabbitMQ 3.12 (not the compose images): thin path 2, 3, 4, 5, 7 (error path), 8 and 9. Checks 1 and 6 need Docker and an API key: run `docker compose up --build` on your machine. Facts found while building: the MCP server SDK 2.4 ships a web-standard HTTP transport, so `@modelcontextprotocol/node` and its hono dependency stay out; amqplib ships its own types; the SDK's API version rejects `temperature`.

| Task | Build | Check | Runs where |
|---|---|---|---|
| 1.1 | `compose.yaml` with postgres and rabbitmq only, `Dockerfile`, `.npmrc`, root `package.json` with workspaces, `tsconfig.base.json`, `biome.json`, `.env.example` | Two healthy containers. `npm ci` works with `ignore-scripts=true` and `min-release-age=7` (thin path 5) | Your machine; `npm ci` also in the cloud session with Node 26 |
| 1.2 | `packages/log`, `packages/events` (envelope, 18 names, zod union with payload schemas only for `chat.message` and `chat.reply`), `packages/db` (pool, `query`, `withTransaction`, `ensureDatabase`, migrate with advisory lock, seed), `packages/bus` (`connect`, `consume`, `publish`, dead-letter setup) | `node --test` passes. A workspace `.ts` package loads under type stripping (thin path 4). The bus test shows the `events` exchange, one queue, `dead-letters` (thin path 3) | Unit tests in the cloud session; db and bus tests need Postgres and RabbitMQ |
| 1.3 | `packages/mcp-kit` (`defineTool`, Fastify bootstrap on `/mcp`) and `services/orders` with one tool `create_draft_order` as a stub; migration and seed on start | MCP Inspector lists the tool. The `orders` database exists after start (thin path 2) | Your machine |
| 1.4 | `packages/decisions` (writer, migration), `packages/agent-runtime` (loop, MCP client, `emit_event`, `done`, limits), `agents/shopping` with `prompt.md`, `agent.json`, `main.ts` | One `chat.message` on the bus produces one decision record and one `chat.reply` (thin path 7) | Your machine; needs `ANTHROPIC_API_KEY` |
| 1.5 | `services/chat-ui`: page with demo login, `POST /chat/messages`, SSE stream per customer | The reply appears in the browser (thin path 6) | Your machine |
| 1.6 | `scripts/new-service.ts`, `_template-service`, `_template-agent`, `scripts/check.sh`, `npm run logs` | `new-service.ts loyalty` makes a container that starts and binds its queue (thin path 8). `check.sh` passes (thin path 9) | Both |
| 1.7 | All 15 containers in `compose.yaml` with digest pins, healthchecks and `depends_on`. Services 2–7 and agents 2–6 start as empty shells that only declare their queue | `docker compose up` on a clean machine starts 15 containers (thin path 1) | Your machine |
| 1.8 | GitHub Actions workflow with `postgres:18` and `rabbitmq:4.4-management` as service containers. Runs `check.sh` and the db and bus tests | CI is green on the PR | GitHub |

Task 1.8 is my addition. Reason: this cloud session has no Docker. With CI, an agent session can prove the db and bus packages without your machine. Cost: one YAML file. Say no if you want to keep the repo free of CI.

## 7. Phase 2: from question to offer

Result for Phases 2–4 (11 Nov 2026): built. `scripts/e2e.ts` runs 11 scenarios over HTTP: success, reject, sold out at approve, address question, quote mismatch, courier unavailable to cancellation, declined, unknown, composition, dead letter, timer. All pass with `AGENT_MODE=scripted` against a local Postgres 16 and RabbitMQ 3.12. Not run: the agents with a model, and `docker compose up`. Decisions the code needed are in design §14, "Decided during the build" (B1–B18).

Goal: success steps 1–3 in design §4. Agent turns: Shopping 1, Offer 1, Notification 1.

| Task | Build | Check |
|---|---|---|
| 2.1 | `services/customers`: tables `customers`, `addresses`; seed; tools `get_customer`, `get_customer_email` | Both tools return the seed rows in MCP Inspector |
| 2.2 | `services/catalogue-mock`: tables `products`, `stock`, `reservations`; seed; tools `search_products`, `get_product` (G1), `reserve_stock` with its three guards; manager page; `POST /manager/restock` and `/manager/price` publish `stock.restocked` and `price.changed` | A restock from the page shows one message in the RabbitMQ UI |
| 2.3 | `services/orders`: tables `drafts`, `offers`, `stock_watches`, `outbox`, `dropped_events`; tools `create_draft_order` (copies the default address, prices from the catalogue), `register_watch`, `propose_offer` (max 3 versions, writes `offer_ready` to the outbox), `get_draft` (G3); outbox relay (500 ms, `FOR UPDATE SKIP LOCKED`, batch 50); Gate consumer (match, close, publish `watch.matched`, or write `dropped_events`) | A node test drives restock → `watch.matched` without an LLM. The relay publishes an outbox row within one second |
| 2.4 | `agents/shopping`: the full prompt. Free text → `search_products` → `create_draft_order`, plus `register_watch` when out of stock → `chat.reply` | "I want 1 kg of coffee beans" with no stock creates a waiting draft and one watch. The decision record shows the tool calls |
| 2.5 | `agents/offer`: `watch.matched` → `propose_offer` | The draft moves from waiting to offered. Offer version 1 exists |
| 2.6 | `services/email`: table `emails`; tool `send_email` (reads the address by `get_customer_email`, each claim cites a `decision_id`); console print; inbox page with approve, reject and address links to `PUBLIC_BASE_URL_ORDERS` | The inbox page lists the email. The console shows it |
| 2.7 | `agents/notification`: `notification.requested` → `read_decisions` (G2) and `get_draft` → `send_email` | The offer email names the price and the reason, with the decision id |

Demonstrable: chat → waiting draft → restock → offer email. Three decision records.

## 8. Phase 3: from approval to delivery

Goal: success steps 4–9. Agent turns in the full path: 9.

| Task | Build | Check |
|---|---|---|
| 3.1 | Orders Response endpoints: `POST /offers/{id}/approve` (calls `reserve_stock`, offered → confirmed, publishes `order.confirmed`; on reserve failure → waiting), `/reject`, `POST /drafts/{id}/address` (changes the draft address, publishes `address.provided`) | Approve from the inbox link moves the draft to confirmed and reserves one unit |
| 3.2 | `services/shipping-mock`: tables `quotes`, `bookings`; tools `geocode`, `quote`, `book` (guards: quote equals the agreed fee, payment authorized; reads the draft by `get_draft`); courier page; `POST /courier/{tracking_id}/dispatch` and `/deliver` publish the two events | A dispatch from the page shows `shipment.dispatched` on two queues |
| 3.3 | `services/payment-mock`: table `authorizations`; tools `authorize`, `capture`, `void` (amount from `get_draft`; `capture` only after `shipment.dispatched`; `unknown` retried 3 times) | `capture` before dispatch is refused by the guard |
| 3.4 | `agents/shipping`: `order.confirmed` and `address.provided` → `geocode`, `quote` → `shipment.quoted`; `payment.authorized` → `book` → `shipment.booked` | Two decision records per order |
| 3.5 | `agents/payment`: `shipment.quoted` → `authorize` → `payment.authorized`; `shipment.dispatched` → `capture` → `payment.captured` | Two decision records per order |
| 3.6 | Orders Status updater: the table in design §5; draft change and `notification.requested` in one transaction | `shipment.delivered` sets state completed and the "delivered" email appears |

Demonstrable: the nine green steps in the flow view, nine decision records, three emails.

## 9. Phase 4: other paths and limits

Goal: every transition in design §8 and every limit in §9.

| Task | Build | Check |
|---|---|---|
| 4.1 | Timer in orders: `setInterval`, `POST /timer/tick`, TTLs from env. Expires offers, watches and address waits. Writes `offer_expired`, `watch_expired` to the outbox | `curl -X POST /timer/tick` with a short TTL expires an offer and sends the email |
| 4.2 | Reject link. Sold out at approve: `reserve_stock` fails → waiting | Two curl scripts, two state changes |
| 4.3 | Address question loop: `shipment.failed` (`address_unresolved`) → `address_pending` → `address_question` email → address form → `address.provided` → Shipping retries | A seed address that geocode rejects ends in a booked shipment after the form |
| 4.4 | Revision loop: `shipment.failed` (`quote_mismatch`, `courier_unavailable`) → Offer agent proposes a new version; version 4 → cancelled and `order_cancelled`; Payment voids on `courier_unavailable` | Three offers then cancelled. The authorization row shows voided |
| 4.5 | Payment failures: `declined` → failed; `unknown` three times → failed; `payment_failed` email | The seed card that declines ends in state failed |
| 4.6 | `agents/inventory` and composition: `composition.requested` → `search_products` → `composition.proposed`; max 1 per offer version | 1 kg out of stock, 2 × 500 g in stock → an offer with two lines |
| 4.7 | Dead letters: a turn that throws goes to `dead-letters`, decision record `status = error`; a turn over the limits gives `status = limit` | One forced error is visible in the RabbitMQ UI and in the decision log |
| 4.8 | `scripts/demo-*.sh`: one curl script per path above, usable without the pages | Each script runs on a fresh `docker compose up` |

Demonstrable: the state diagram in design §8, transition by transition.

## 10. Phase 5: workshop readiness

Result (11 Nov 2026): 5.1 done: the loyalty example (`agent-commerce/examples/loyalty.patch`) changes 2 existing files (the event list and the Status updater) plus the generated compose entry; the Notification agent does not change. The fraud check is not built; by reading the code it changes the Shipping agent (`agent.json` and prompt), the Payment agent (`agent.json`, prompt, `scripted.ts`), the Status updater and the event list. 5.2 done (README, CONTRIBUTING; the participant checklist stays in the deck). 5.3: `demo-runbook.md` written; its curl commands ran in order against Docker; the talk with a person is still to do. 5.4: `scripts/cost.ts` is ready; the number needs model runs. 5.5: `docker compose up` ran on a clean Docker daemon (Linux, cloud session) with scripted agents: 15 containers, 11 of 11 e2e scenarios; Docker Desktop on macOS is not tested. 5.6 done: deck facts and both diagrams updated. 5.7 done (`scripts/reset.sh`).

| Task | Build | Check |
|---|---|---|
| 5.1 | Prove the extension story: generate `loyalty` and `fraud` with the generator. Count the changed existing files | The counts match design §12: 1 and 3 |
| 5.2 | `README.md` for agent-commerce (start, ports, pages, the nine steps), `CONTRIBUTING.md` (the one dependency rule, check.sh), participant checklist from the deck "Before you come" | A person who did not build it starts the demo from the README |
| 5.3 | Demo runbook: the show-and-tell sequence, the curl fallback, and a replay fallback from recorded logs for when the API is down | A dry run from the runbook takes the planned time |
| 5.4 | Cost per full order: read `tokens_in` and `tokens_out` from `decision_records` over five runs | Numbers in the deck slide "Cost per full order" |
| 5.5 | Clean-machine test on a second machine with Docker Desktop on macOS | `git clone`, `.env`, `docker compose up`, first reply within the time you accept |
| 5.6 | Deck update: tool names, counts and the layer view where the build changed a fact | Deck and code agree |
| 5.7 | `scripts/reset.sh` (drop volumes) for repeated demos. Optional: image scan in `check.sh` | A reset and restart takes under two minutes |

## 11. Where each check runs

| Check type | Cloud session (this) | Your machine | CI (task 1.8) |
|---|---|---|---|
| `tsc --noEmit`, Biome, `node --test` unit tests | Yes, after Node 26 install from nodejs.org | Yes | Yes |
| `npm ci` with the `.npmrc` controls | Yes, with Node 26 | Yes | Yes |
| Postgres and RabbitMQ integration tests | No | Yes | Yes, as service containers |
| `docker compose up`, 15 containers, healthchecks | No | Yes | No |
| MCP Inspector, pages, SSE in a browser | No | Yes | No |
| Agent turns with the Anthropic API | Only with a key in the environment | Yes | Only with a secret |

## 12. Traceability

| Design section | Phase |
|---|---|
| §1 core rules | 1 (rules 3, 6, 13), 2 (9, 10, 11, 12), 3 (1, 2, 4, 5, 7, 8) |
| §2 layers | 1 |
| §3 actors and entry points | 1 (chat), 2 (manager), 3 (response, courier), 4 (timer) |
| §4 success path | 2 (steps 1–3), 3 (steps 4–9) |
| §5 event catalogue | 1 (envelope, names), 2–4 (payload schemas as used) |
| §5 status updater | 3, 4 |
| §6 MCP servers | 1 (shape), 2 (orders, customers, catalogue, email), 3 (shipping, payment) |
| §7 flow after approval | 3, 4 |
| §8 draft states | 2, 3, 4 |
| §9 loops and limits | 4 |
| §11 agent or code | 0 (confirm) |
| §12 how to add a service | 1 (generator), 5 (proof) |
| §14 stack, containers, databases, RabbitMQ | 1 |
| Landscape §5 supply chain | 1 |
| Landscape §9 thin path | 1 |

## 13. Risks

| Risk | Effect | Action |
|---|---|---|
| Workspace `.ts` packages under type stripping (symlinks) | Blocks every shared package | First check in task 1.2. Fallback: `--preserve-symlinks` or a `paths` map |
| TypeScript 7 native compiler drops or changes tsconfig options | `tsc --noEmit` fails | Decide in 0.8. Safe choice: pin TypeScript 6 |
| `@fastify/static` 10 peer range | Pages do not serve | Check the peer range in 0.8 |
| MCP SDK 2.4 changed the Fastify adapter API since 2.0 | `mcp-kit` bootstrap | Read the v2 changelog in 0.8 |
| `min-release-age=7` rejects the newest patch | A pin fails | Pin the version that `npm view` returns under the rule |
| No Docker in the cloud session | Compose checks need you | Task 1.8 moves the db and bus checks to CI |
| API cost during Phases 2–4 | Many agent turns per test | Keep agent tests to one turn each. Use plain-code tests for the Gate, outbox, Status updater, Timer |
| A service in the middle of a chain | Phase 4 changes Phase 3 consumers | Known limit of choreography (design §12). Accept |

## 14. How we work

- One PR per phase. One commit per task. The commit message names the task id and its check.
- A design change goes as a diff block, one section per turn, before the code.
- A task is done when its check passes. The PR text lists each check and where it ran.
- The next phase does not start before the phase check passes on your machine.
