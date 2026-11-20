# agent-commerce — technical landscape

Status: decided on 10 Nov 2026. Companion to `multi-agent-design.md` (v7; the changes in §10 are applied).
Facts were checked on 10 Nov 2026. Each fact has a source. "Not verified" marks a fact from memory or from a secondary source. Check those before you depend on them.

Two tests decided every choice: easy to show, and easy to add a service. Supply-chain safety and library maturity ranked above features.

## 1. Approach

Skeleton first. The compose file, the shared packages, the MCP server shape, the agent shape and the generator script come first. Business logic, table columns and guard rules come later, one service at a time.

Decided before the skeleton, because every service depends on them: the event envelope (#11), who declares the topology (#12), the consumer wrapper (#13), the outbox relay method (#15), the MCP transport (#7), and the migration and seed mechanism (#18, #19).

The first thing that must work end to end: `chat.message` → Shopping agent → `chat.reply` (edges e1, e2). It crosses the bus, one agent, one MCP client and one page.

## 2. Decision summary

| # | Decision | Choice |
|---|---|---|
| 1 | Model provider | Anthropic API only, `@anthropic-ai/sdk`. Model name from env |
| 2 | Agent loop | Own loop, about 40 lines, once, in `packages/agent-runtime`. No framework. Hidden from the workshop audience |
| 3 | MCP client in agents | `@modelcontextprotocol/client@2`, Streamable HTTP, servers from env |
| 4 | Turn limits | 8 model calls, 1024 output tokens, 60 s. No `temperature`: the SDK 1.4.0 sends API version 2026-10-21, which rejects sampling parameters (found in Phase 1). `effort` from `agent.json` replaces it |
| 5 | Agent files | `prompt.md`, `agent.json`, `main.ts` per agent |
| 6 | MCP SDK | v2 split packages: `@modelcontextprotocol/server`, `/client`, `/fastify` |
| 7 | MCP transport | Streamable HTTP, stateless, path `/mcp` |
| 8 | Schema library | zod 4, for events, tool inputs and HTTP bodies |
| 9 | MCP auth | None. Ports inside the compose network only |
| 10 | AMQP client | `amqplib` 2.x, built-in recovery |
| 11 | Event envelope | `event_id, type, occurred_at, draft_id, offer_version, decision_id, payload`; `decision_id` is null when the producer is not an agent; zod discriminated union |
| 12 | Topology | Each consumer asserts its own queue and bindings on start |
| 13 | Consumer wrapper | `connect`, `consume`, `publish` in `packages/bus`; prefetch 1; manual ack |
| 14 | Failed turn | `nack(requeue: false)` to one `dead-letters` queue |
| 15 | Outbox relay | Poll every 500 ms, `FOR UPDATE SKIP LOCKED` |
| 16 | Postgres driver | `pg` |
| 17 | Query layer | Raw SQL, `query()` and `withTransaction()` helpers |
| 18 | Migrations | SQL files per service, 40-line runner, advisory lock, run at start; the runner creates the database if missing |
| 19 | Seed data | Idempotent SQL files, run after migrations |
| 20 | HTTP framework | Fastify 5 |
| 21 | Pages | Static HTML + vanilla JS via `@fastify/static`; JSON endpoints shared with curl |
| 22 | Chat live update | Server-Sent Events, no library |
| 23 | Timer | `setInterval` in orders; TTLs from env; `POST /timer/tick` |
| 24 | Node image | `node:26-slim`, digest-pinned, `node` user |
| 25 | Postgres image | `postgres:18` |
| 26 | RabbitMQ image | `rabbitmq:4.4-management` (confirm the tag; fallback 4.3) |
| 27 | Compose layout | One image for all Node containers, `command` per service |
| 28 | Model access | `ANTHROPIC_API_KEY` and `MODEL_NAME` in `.env` |
| 29 | Package manager | npm workspaces |
| 30 | Shared packages | `events`, `bus`, `db`, `decisions`, `mcp-kit`, `log`, `agent-runtime` |
| 31 | TypeScript | Node 26 type stripping, `tsc --noEmit`, ESM, `.ts` in import paths |
| 32 | Logging | pino in containers; `pino-pretty` as a root dev dependency, used only on the host |
| 33 | Supply chain | `.npmrc` hardening, `npm ci`, `npm audit signatures`, digest-pinned images |
| 34 | Lint, format, test | Biome; `node:test` |

## 3. Runtime and base images

| Item | Version | Date | License | Maintainer | Known security issues | Source |
|---|---|---|---|---|---|---|
| Node.js | 26 LTS "Lithium", 26.13.0 | 2026-10-28; updates to April 2029 | MIT (not verified) | OpenJS Foundation | — | https://nodejs.org/en/blog/release/v26.13.0 |
| npm | 11.20.x bundled with Node 26.11+ (exact in 26.13 not verified) | — | Artistic-2.0 (not verified) | npm, Inc. (GitHub) | — | https://nodejs.org/en/download/archive/v26.1.0 |
| `node` Docker image | `node:26-slim` (Debian 13 trixie), about 82 MB compressed | pushed daily | — | Docker Official Image, Node community | Debian images get security releases before Alpine images | https://hub.docker.com/_/node/tags?name=26 , https://github.com/nodejs/docker-node |
| PostgreSQL | 18 (18.6 on 2026-08-13). 19 is at RC 1 (2026-10-15), not GA | — | PostgreSQL License (not verified) | PGDG | — | https://www.postgresql.org/ |
| `postgres` Docker image | `postgres:18` | — | — | Docker Official Image | — | https://hub.docker.com/_/postgres (not fetched) |
| RabbitMQ | 4.4.0 | 2026-10-20; community support to 2027-07-31 | MPL-2.0 (one source adds Apache-2.0) | Broadcom | — | https://www.rabbitmq.com/release-information |
| `rabbitmq` Docker image | `rabbitmq:4.4-management` (tag not verified; `4.2-management` pattern confirmed) | — | — | Docker Official Image, Docker community, not Broadcom | Alpine variants have missed tags before (issue #748) | https://github.com/docker-library/rabbitmq/issues/748 |

Node type stripping facts (Node 26 docs, https://nodejs.org/download/release/latest/docs/api/typescript.html):
- Stability 2 (Stable) in Node 26.
- Not supported: `enum`, namespaces with runtime code, parameter properties, import aliases, decorators.
- File extensions are mandatory in imports: `import './x.ts'`.
- `import type` is required for type-only imports.
- Node refuses `.ts` files under a `node_modules` path. Workspace packages are symlinks; Node resolves to the real path by default, so they should load. **Not verified. Test in the thin path.**
- tsconfig: `"module": "nodenext"`, `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"allowImportingTsExtensions": true`, `"noEmit": true`.

## 4. Libraries

| Library | Version | Date | License | Maintainers | Runtime deps | Known security issues | Source |
|---|---|---|---|---|---|---|---|
| `@anthropic-ai/sdk` | 1.4.0 | 2026-11-02 | MIT | Anthropic, 15 npm maintainers, 65M weekly downloads | 2 (checked at 0.105) | None found | https://socket.dev/npm/package/@anthropic-ai/sdk/overview/1.4.0 |
| `@modelcontextprotocol/server`, `/client`, `/core`, `/fastify` | 2.0.0 (later 2.0.x patches likely) | 2026-07-27 | MIT | MCP project; npm publish by OIDC trusted publishing | Not counted for v2 | GHSA-frvp-7c67-39w9 in `@hono/node-server`, reached through `@modelcontextprotocol/node`; SDK 1.30 widened past it. We use the Fastify adapter, not the node adapter | https://github.com/modelcontextprotocol/typescript-sdk/releases |
| `amqplib` | 2.2.0 | 2026-09-28 | MIT | One releaser since 2026 (cressie176); project since 2013; 3.8k stars | Likely 0 after 2.0.1 (not verified) | None reported (meterian) | https://github.com/amqp-node/amqplib/releases |
| `zod` | 4.6.7 | 2026-10-12 | MIT | Colin McDonnell; staged npm releases with approval | 0 | Six malicious commits reached `main` on 2026-09-21 by a compromised git credential; reverted the same day; nothing reached npm | https://github.com/colinhacks/zod/releases |
| `pg` | 8.x (exact patch not verified) | last release seen 2026-06-19 | MIT (not verified) | brianc and contributors; monorepo | A few same-author packages | None for `pg`; `pg-native` has 1 CVE and is not used | https://releasealert.dev/npmjs/_/pg/links |
| `fastify` | 5.8.5 (later patches likely) | 2026-04-14 | MIT | 811 committers; lead mcollina; OpenJS project (not verified) | about 15–25 transitive (not verified) | Four CVEs fixed Feb–Apr 2026 (5.7.3, 5.8.1, 5.8.3, 5.8.5), each in a patch release | https://releasebot.io/updates/fastify |
| `@fastify/static` | 8.1.x | — | MIT | fastify org, 16 npm collaborators | — | Two old advisories in the deprecated `fastify-static` 4.x line, fixed about 4 years ago | https://classic.yarnpkg.com/en/package/@fastify/static |
| `pino` | 10.4.0 | 2026-10-02 | MIT | mcollina, jsumners; 4 npm maintainers | about 10 (not verified) | None found; prototype-pollution hardening in 10.1.1 | https://github.com/pinojs/pino/releases |
| `pino-pretty` (host only, dev) | 13.1.3 | — | MIT | pinojs org, 3 maintainers | 13 | None known (DepScope snapshot) | https://depscope.dev/pkg/npm/pino-pretty |
| `@biomejs/biome` (dev) | 2.6 | 2026-10-15 | MIT OR Apache-2.0 | Biome core team | 0 (native binary per platform) | None found | https://biomejs.dev/blog/ |
| `typescript` (dev) | 6.0.3, pinned below 7. npm `latest` is 7.0.2 (the native compiler, 2026-07-08); 6 is the known compiler and `tsc --noEmit` is the only use (Phase 0 decision) | — | Apache-2.0 (not verified) | Microsoft | — | — | — |
| `node:test` | built in | — | — | Node.js | 0 | — | Node API index |

Rejected, with the reason:

| Library | Reason |
|---|---|
| `postgres` (Postgres.js) | Maintenance in question since May 2025; one maintainer; scorecard warnings |
| `rabbitmq-client` | Zero deps and a nicer API, but one maintainer and a small user base |
| `rabbitmq-amqp-js-client` (AMQP 1.0) | 1.0.0 in June 2026; small team; license and deps not verified |
| `amqp-connection-manager` | Not needed: amqplib 1.1+ has recovery |
| `fastify-type-provider-zod` | One maintainer; replaced by `Schema.parse(request.body)` in handlers |
| Drizzle, Kysely, Prisma | More concepts than 12 small tables need; Drizzle 1.0 in beta |
| Vercel AI SDK, LangGraph, Mastra, Claude Agent SDK | Each brings its own orchestration or hides the loop behind a heavier tree; the bus is the orchestration here |
| Anthropic tool runner | Beta; saves about 20 lines in a file nobody sees |
| ESLint + Prettier | Three packages and many transitive ones against one |
| Distroless Node image | No shell; hard to inspect in a workshop |
| Local model in a container | Docker Desktop on macOS runs a Linux VM with no GPU access |

## 5. Supply-chain controls

Why: in 2026 the npm ecosystem saw self-propagating worms (ChainDrop on 2026-08-04: 444 packages, 2,212 malicious versions; Mini Shai-Hulud in May; a `binding.gyp` attack on 2026-06-03). ChainDrop's headline packages were published with valid provenance, so provenance alone does not protect. Install scripts and fresh releases are the main vectors.

`.npmrc` at the repo root:

```
ignore-scripts=true
min-release-age=7
save-exact=true
allow-git=none
```

`min-release-age` needs npm 11.10 or later (Node 26 ships 11.20). `allow-git` is from a secondary source; confirm in `npm config list`.

| Control | Where |
|---|---|
| Lockfile committed; `npm ci` in Dockerfiles | repo, Dockerfile |
| `npm audit signatures` and `npm audit` | `scripts/check.sh` |
| Every `FROM` and compose `image:` pinned by digest | Dockerfile, compose |
| One rule: a new dependency needs a reason in the PR | CONTRIBUTING |
| Image scan (`docker scout cves` or Trivy) | optional, `scripts/check.sh` |

Open check: `ignore-scripts=true` must not break `@biomejs/biome` (platform binaries come as optional dependencies, not postinstall — not verified). Run `npm ci` in the thin path.

## 6. Repository layout

```
agent-commerce/
  package.json              workspaces: packages/*, services/*, agents/*
  .npmrc  biome.json  tsconfig.base.json  compose.yaml  Dockerfile  .env.example
  scripts/new-service.ts    generator: copies the template, adds compose entry and bindings
  scripts/check.sh          tsc --noEmit, biome ci, node --test, npm audit signatures
  packages/
    events/     event names, envelope schema, zod union
    bus/        connect, consume, publish; dead-letter setup
    db/         pool, query, withTransaction, migrate, seed, ensureDatabase
    decisions/  decision record writer + its migration
    mcp-kit/    defineTool({ name, input, guard, run }), server bootstrap on Fastify
    log/        log() over pino
    agent-runtime/  the loop, MCP client, local tools emit_event and done, limits
  services/
    chat-ui/  orders/  customers/  email/  catalogue-mock/  shipping-mock/  payment-mock/
      src/main.ts  public/  migrations/  seed/
  agents/
    shopping/  offer/  inventory/  notification/  shipping/  payment/
      prompt.md  agent.json  main.ts
  _template-service/  _template-agent/
```

## 7. Runtime settings

| Setting | Value |
|---|---|
| Host ports | chat-ui 3000, orders 3001, email 3002, catalogue-mock 3003, shipping-mock 3004. MCP ports stay internal |
| Email links | `PUBLIC_BASE_URL_ORDERS=http://localhost:3001` on the email container |
| Database URL | `postgres://ac:ac@postgres:5432/<db>`; one Postgres user; `Pool({ max: 5 })` |
| Timer | `TIMER_INTERVAL=30s`, `OFFER_TTL`, `WATCH_TTL`, `ADDRESS_TTL` (minutes for the demo) |
| Agent | `MCP_SERVERS=http://orders:3001/mcp,...`, `MODEL_NAME`, `ANTHROPIC_API_KEY`, limits in `agent.json` |
| Outbox relay | 500 ms poll, batch 50 |
| Healthchecks | `pg_isready -U ac`; `rabbitmq-diagnostics -q ping`; `depends_on: condition: service_healthy` |
| Demo log view | `npm run logs` = `docker compose logs -f --no-log-prefix | pino-pretty`; every line carries `name` |

## 8. Agent runtime

Loop (in `packages/agent-runtime`, never shown in the workshop):

```
turn(event):
  messages = [system(prompt.md), user(render(event))]
  repeat up to limits.maxCalls:
    reply = messages.create({ model, max_tokens, tools, messages })
    record(reply)
    if no tool_use blocks: break
    for each tool_use:
      result = localTools[name] ? runLocal(name, input) : mcp.callTool(name, input)
      messages.push(reply, tool_result(result))
  write decision record
  publish queued events
```

Local tools: `emit_event(type, payload)` — allowed only if `type` is in `agent.json.emits` and the payload passes the zod schema; `done(summary)`; `read_decisions(decision_ids)` — reads rows from `decision_records`, used by the Notification agent (decided in Phase 0 of the work plan, item G2).

Decision record columns: `decision_id, agent, event_id, event_type, draft_id, offer_version, model, started_at, duration_ms, tokens_in, tokens_out, tool_calls jsonb, emitted_events jsonb, output_text, status (ok|limit|error)`. Every emitted event carries the `decision_id` in its envelope field `decision_id` (#11).

## 9. Thin path checklist

The skeleton is done when all of these pass on a clean machine with one command.

| # | Check |
|---|---|
| 1 | `docker compose up` builds one Node image and starts 15 containers; postgres and rabbitmq healthchecks pass |
| 2 | Each service creates its database if missing, runs migrations under the advisory lock, applies seeds |
| 3 | The RabbitMQ UI shows `events` exchange, one queue per consumer, `dead-letters` |
| 4 | A workspace package with `.ts` files loads under type stripping |
| 5 | `npm ci` works with `ignore-scripts=true` and `min-release-age=7` |
| 6 | Chat page sends `chat.message`; Shopping agent calls one MCP tool and emits `chat.reply`; the page shows it by SSE |
| 7 | The decision record row exists with the tool call and the emitted event |
| 8 | `scripts/new-service.ts loyalty` produces a container that starts and binds its queue |
| 9 | `scripts/check.sh` passes |

## 10. Design document changes (v6 → v7)

Applied on 10 Nov 2026. Kept as the record of what changed.

| Section | Change |
|---|---|
| §3 | Clock row gains `POST /timer/tick`; layer view Clock label "schedule or curl" |
| §5 | Envelope fields: `event_id, type, occurred_at, draft_id, offer_version, decision_id, payload` (`decision_id` added during the v7 session) |
| §6 | "Transport: Streamable HTTP, stateless, path `/mcp`" |
| §12 | Step 5: an agent publishes only through `emit_event`, checked against its `emits` list |
| §14 | Queue `dead-letters`; each consumer declares its own queue and bindings; shared packages list; decisions migration lives in `packages/decisions`; decision record columns; host ports |

No flow-view edge changes. One label changes in the layer view. Both diagram files are renamed to v7.

## 11. Sources

- Node releases: https://nodejs.org/en/about/previous-releases
- Node 26.13.0 (LTS): https://nodejs.org/en/blog/release/v26.13.0
- Node TypeScript docs: https://nodejs.org/download/release/latest/docs/api/typescript.html
- npm 11.10.0 (`min-release-age`): https://github.com/semantic-release/github/pull/1170 ; https://gist.github.com/mcollina/b294a6c39ee700d24073c0e5a4e93104
- Docker Hub node tags: https://hub.docker.com/_/node/tags?name=26
- PostgreSQL releases: https://www.postgresql.org/
- RabbitMQ release information: https://www.rabbitmq.com/release-information
- docker-library/rabbitmq issue #748: https://github.com/docker-library/rabbitmq/issues/748
- amqplib releases and changelog: https://github.com/amqp-node/amqplib/releases ; https://github.com/amqp-node/amqplib/blob/main/CHANGELOG.md
- rabbitmq-client: https://github.com/cody-greene/node-rabbitmq-client
- zod releases: https://github.com/colinhacks/zod/releases
- MCP versioning: https://modelcontextprotocol.io/docs/learn/versioning
- MCP TypeScript SDK releases: https://github.com/modelcontextprotocol/typescript-sdk/releases
- MCP SDK v1 on socket.dev: https://socket.dev/npm/package/@modelcontextprotocol/sdk/overview/1.32.1
- pg on releasealert: https://releasealert.dev/npmjs/_/pg/links
- Postgres.js maintenance discussion: https://github.com/porsager/postgres/discussions/1125
- Fastify release notes: https://releasebot.io/updates/fastify
- @fastify/static: https://classic.yarnpkg.com/en/package/@fastify/static
- fastify-type-provider-zod: https://github.com/turkerdev/fastify-type-provider-zod
- pino releases: https://github.com/pinojs/pino/releases
- pino-pretty: https://depscope.dev/pkg/npm/pino-pretty
- Biome blog: https://biomejs.dev/blog/
- @biomejs/biome on pkgpulse: https://www.pkgpulse.com/packages/%40biomejs/biome
- @anthropic-ai/sdk: https://socket.dev/npm/package/@anthropic-ai/sdk/overview/1.4.0
- Tool runner (beta): https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner
- Claude Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Vercel AI SDK 7: https://www.developersdigest.tech/blog/vercel-ai-sdk-whats-new-2026
- LangChain JS, MCP: https://docs.langchain.com/oss/javascript/use-mcp
- ChainDrop npm worm: https://stepsecurity.io/blog/chaindrop-npm-worm
- binding.gyp attack: https://threatcluster.io/cluster/large-scale-supply-chain-attack-targets-npm-packages-via-bin-4588b024
- 637 packages in 39 minutes: https://dev.to/piiiico/637-npm-packages-compromised-in-39-minutes-the-malware-installs-a-claude-code-sessionstart-hook-ch4
- Docker Desktop on macOS, no GPU: https://chariotsolutions.com/?p=18773
- Distroless images: https://github.com/GoogleContainerTools/distroless

## 12. Found during the build (10–11 Nov 2026)

| Item | Fact | Effect |
|---|---|---|
| Pinned versions | `@anthropic-ai/sdk` 1.4.0, `@modelcontextprotocol/server` and `/client` 2.4.0, `amqplib` 2.2.1, `zod` 4.6.7, `pg` 8.23.1, `fastify` 5.12.8, `@fastify/static` 10.1.8, `pino` 10.4.0, `pino-pretty` 13.2.0, `@biomejs/biome` 2.6.4, `typescript` 6.0.3, `@types/node` 26.6.6, `@types/pg` 8.23.1. Each is the newest release at least 7 days old on 10 Nov | `package-lock.json` |
| MCP transport | SDK 2.4 has `createMcpHandler` (web-standard Request and Response). `mcp-kit` mounts it on a Fastify route. `@modelcontextprotocol/fastify` and `@modelcontextprotocol/node` (with hono) are not used | One less adapter |
| amqplib types | amqplib 2.x ships its own types; `connect(url, { recovery })` is the recovery API | `@types/amqplib` removed |
| Sampling parameters | SDK 1.4.0 sends API version 2026-10-21, which rejects `temperature` | #4 has no temperature; `effort` in `agent.json` |
| Thinking | Current models think by default; thinking tokens count toward `max_tokens` | #4: 4096 in place of 1024 |
| Refusal fallback | The agent loop calls `beta.messages.create` with `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Only the types are checked; no request has run | Check on the first local run |
| Tool schemas | zod and MCP add a `$schema` key to JSON Schema; the runtime removes it before the Messages API call | Not verified against the API |
| Docker images | Digests: `node:26-slim` sha256:5adad64f…, `postgres:18` sha256:e3d24f69…, `rabbitmq:4.4-management` sha256:af6f50d3… (Docker Hub, 10 Nov). The 4.4 tag exists | #26 closed |
| `npm audit` | 3 moderate advisories in `glob` and `minimatch` through `@fastify/static` 10.1.8; fixed in 10.1.10 (younger than 7 days on 10 Nov) | `check.sh` audits at level `high` until then |
| `npm audit signatures` | Needs `tuf-repo-cdn.sigstore.dev` and `rekor.sigstore.dev`; a restricted network fails it | Runs on a normal network only |
| Postgres 18 volume | The image keeps data under `/var/lib/postgresql/18/docker` (PGDATA); the volume mounts `/var/lib/postgresql`. Checked in a running container on 11 Nov | Correct as written |
| TLS interception in the build | A proxy that intercepts TLS breaks `npm ci` in the image build (`SELF_SIGNED_CERT_IN_CHAIN`). The Dockerfile takes an optional BuildKit secret `npm_ca` and sets `NODE_EXTRA_CA_CERTS` only when it is not empty; compose reads it from `NPM_CA_FILE`. The file must be inside the project folder (Compose bake refuses other paths). TLS checks stay on; the certificate is not in the image | Verified in the cloud session on 11 Nov |
