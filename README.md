# agent-commerce

A proof-of-concept blueprint for multi-agent orchestration. An e-commerce shop is the example use case. The design is in [`../docs/multi-agent-design.md`](../docs/multi-agent-design.md); the stack is in [`../docs/technical-landscape.md`](../docs/technical-landscape.md); the build plan is in [`../docs/work-plan.md`](../docs/work-plan.md).

Status: Phase 1, the skeleton. One chat message gets one reply through the bus, one agent and one MCP tool. The other services and agents are shells that declare their queues.

## Start

You need Docker with Compose, and an Anthropic API key.

```sh
cp .env.example .env        # put ANTHROPIC_API_KEY in .env
docker compose up --build   # 15 containers: 7 services, 6 agents, postgres, rabbitmq
```

| Page | URL |
|---|---|
| Chat (demo login) | http://localhost:3000 |
| RabbitMQ UI (user `ac`, password `ac`) | http://localhost:15672 |
| Orders MCP, for MCP Inspector | http://localhost:3001/mcp |

Logs: `npm run logs` (needs `npm ci` on the host; it pipes `docker compose logs` through `pino-pretty`).

## Develop on the host

You need Node 26 (`npm` 11.10 or later, for `min-release-age`).

```sh
npm ci              # ignore-scripts, min-release-age=7, save-exact, allow-git=none (.npmrc)
npm run typecheck   # tsc --noEmit; the code runs through Node type stripping, no build step
npm run lint        # biome ci
npm test            # node --test; the db and bus tests run only with DATABASE_URL and AMQP_URL set
bash scripts/check.sh
```

## Add a service

```sh
node scripts/new-service.ts loyalty --consumes shipment.delivered --port 3005
node scripts/new-service.ts fraud --agent --consumes payment.authorized --emits fraud.cleared,fraud.flagged
npm install
docker compose up --build
```

The generator copies `_template-service/` or `_template-agent/`, fills the names, and adds one entry to `compose.yaml`. No existing queue changes. A new event type is added to `packages/events/src/index.ts`.

## Layout

| Path | What |
|---|---|
| `packages/events` | The 18 event types, the 7-field envelope, `newEvent`, `parseEnvelope` |
| `packages/bus` | `connectBus`: publish to the `events` topic exchange; consume with prefetch 1, manual ack, `dead-letters` |
| `packages/db` | `startDatabase`: create the database if missing, migrate under an advisory lock, seed; `query`, `withTransaction` |
| `packages/decisions` | The `decision_records` table and its writer and reader |
| `packages/mcp-kit` | `defineTool({ name, input, guard, run })`, `GuardError`, `registerMcp` on Fastify at `/mcp` |
| `packages/agent-runtime` | `runAgent(dir)`: one bounded turn per event; local tools `emit_event`, `done`, `read_decisions` |
| `packages/log` | `log(name)` over pino |
| `services/*` | One container each: `src/main.ts`, `migrations/`, `seed/`, `public/` |
| `agents/*` | One container each: `prompt.md`, `agent.json`, `main.ts` |
| `scripts/new-service.ts`, `scripts/check.sh` | The generator and the checks |
