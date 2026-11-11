# agent-commerce

A proof-of-concept blueprint for multi-agent orchestration. An e-commerce shop is the example use case: a customer asks in a chat, waits for stock, approves an offer from an email, and a chain of agents and plain-code reactors ships and charges the order.

| Document                                                           | What                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| [`../docs/multi-agent-design.md`](../docs/multi-agent-design.md)   | The architecture (v7) and the decisions made during the build (§14) |
| [`../docs/technical-landscape.md`](../docs/technical-landscape.md) | The stack, versions, sources                                        |
| [`../docs/demo-runbook.md`](../docs/demo-runbook.md)               | The show-and-tell, step by step, with curl fallbacks                |
| [`../docs/handover-local.md`](../docs/handover-local.md)           | State of the build and what to check on a local machine             |

## Start

You need Docker with Compose 2.24 or later, and an Anthropic API key.

```sh
cp .env.example .env        # put ANTHROPIC_API_KEY in .env
docker compose up --build   # 15 containers: 7 services, 6 agents, postgres, rabbitmq
```

No key, or the API is down? Set `AGENT_MODE=scripted` in `.env`. The six agents then run fixed rules from `agents/*/scripted.ts`, with the same tools, guards, events and decision records.

| Page                                                                   | URL                    | Actor          |
| ---------------------------------------------------------------------- | ---------------------- | -------------- |
| Chat, with demo login                                                  | http://localhost:3000  | Mia (customer) |
| Orders board: drafts, offers, history, decision records, Timer buttons | http://localhost:3001  | Presenter      |
| Inbox: emails with Approve, Reject and the address form                | http://localhost:3002  | Mia            |
| Manager: restock and price                                             | http://localhost:3003  | Shop manager   |
| Courier: dispatch and deliver                                          | http://localhost:3004  | Courier        |
| RabbitMQ UI (user `ac`, password `ac`)                                 | http://localhost:15672 | Presenter      |

Logs: `npm ci` once on the host, then `npm run logs`.
Start again from the seed data: `bash scripts/reset.sh`.

## Demo customers and fault triggers

Each fault comes from a seed row, not from a toggle.

| Customer                 | What happens                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Mia                      | Success path                                                                               |
| Nora                     | Her address does not resolve: the address question email, then the form                    |
| Leo                      | Remote postcode: the quote (AUD 25.00) differs from the offer (AUD 10.00): offer version 2 |
| Dan                      | The card is declined                                                                       |
| Ivy                      | The bank answers "unknown" three times                                                     |
| Anyone, product `kettle` | No courier takes it: three offers, then the order is cancelled                             |

Products: `coffee-1kg` (out of stock at start), `coffee-500g`, `tea-250g`, `kettle`.

## Develop on the host

You need Node 26 (npm 11.10 or later, for `min-release-age`).

```sh
npm ci                                   # .npmrc: ignore-scripts, min-release-age=7, save-exact, allow-git=none
docker compose up -d postgres rabbitmq   # infra only
bash scripts/dev-host.sh                 # the 13 Node processes on the host; logs in .dev-logs/
node scripts/e2e.ts                      # 11 scenarios over HTTP
bash scripts/check.sh                    # tsc, biome, node --test, npm audit
```

`scripts/e2e.ts` also runs against `docker compose up`. It changes stock and moves the Timer forward, so do not run it during a live demo.

## Add a service

```sh
node scripts/new-service.ts loyalty --consumes shipment.delivered --port 3007
node scripts/new-service.ts fraud --agent --consumes payment.authorized --emits fraud.cleared,fraud.flagged
npm install
```

The generator copies `_template-service/` or `_template-agent/`, fills the names, formats the result and adds one entry to `compose.yaml`. No existing queue changes. A new event type goes into `packages/events/src/index.ts`.

[`examples/loyalty.patch`](examples/loyalty.patch) is a complete worked example: loyalty points after delivery and a points email. It changes two existing files (the event list and the Status updater) and adds the service. Apply it with `git apply examples/loyalty.patch`.

## Layout

| Path                     | What                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/events`        | The 18 event types, the 7-field envelope, `newEvent`, `parseEnvelope`                                                                 |
| `packages/bus`           | `connectBus`: publish to the `events` topic exchange; consume with prefetch 1, manual ack, `dead-letters`                             |
| `packages/db`            | `startDatabase`: create the database if missing, migrate under an advisory lock, seed                                                 |
| `packages/decisions`     | The `decision_records` table, its writer and readers                                                                                  |
| `packages/mcp-kit`       | `defineTool({ name, input, guard, run })`, `GuardError`, `registerMcp` on Fastify at `/mcp`, `connectTool` for server-to-server calls |
| `packages/agent-runtime` | `runAgent(dir)`: one bounded turn per event; local tools `emit_event`, `done`, `read_decisions`; scripted mode                        |
| `packages/log`           | `log(name)` over pino                                                                                                                 |
| `services/*`             | One container each: `src/main.ts`, `migrations/`, `seed/`, `public/`                                                                  |
| `agents/*`               | One container each: `prompt.md`, `agent.json`, `main.ts`, and `scripted.ts` (fallback)                                                |
| `scripts/`               | `new-service.ts`, `check.sh`, `dev-host.sh`, `e2e.ts`, `reset.sh`                                                                     |
