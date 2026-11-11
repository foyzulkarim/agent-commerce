import path from "node:path";
import { connectBus } from "@ac/bus";
import { startDatabase } from "@ac/db";
import { openDecisions } from "@ac/decisions";
import { log } from "@ac/log";
import { connectTool, createApp, registerMcp } from "@ac/mcp-kit";
import fastifyStatic from "@fastify/static";
import { config } from "./config.ts";
import type { Deps } from "./drafts.ts";
import { registerEndpoints } from "./endpoints.ts";
import { gateHandler } from "./gate.ts";
import { startRelay } from "./relay.ts";
import { STATUS_EVENTS, statusHandler } from "./status-updater.ts";
import { tick } from "./timer.ts";
import { ordersTools } from "./tools.ts";

const logger = log("orders");
const here = import.meta.dirname;

const pool = await startDatabase({
  databaseUrl: config.databaseUrl,
  migrationsDir: path.join(here, "..", "migrations"),
  log: logger,
});
const decisions = await openDecisions(config.decisionsUrl, logger);
const bus = await connectBus(config.amqpUrl, logger);

const deps: Deps = {
  pool,
  catalogue: connectTool(config.catalogueMcp, "orders"),
  customers: connectTool(config.customersMcp, "orders"),
  shipping: connectTool(config.shippingMcp, "orders"),
  log: logger,
};

// Plain-code reactors in the orders container (design §2).
await bus.consume("gate", ["stock.restocked", "price.changed"], gateHandler(deps));
await bus.consume("status-updater", STATUS_EVENTS, statusHandler(deps));
startRelay(pool, bus, logger);
setInterval(() => {
  tick(deps).catch((error) => logger.error({ err: error }, "timer tick failed"));
}, config.timerIntervalMs);

const app = createApp();
await app.register(fastifyStatic, { root: path.join(here, "..", "public") });
app.get("/health", async () => ({ ok: true, service: "orders" }));
registerEndpoints(app, deps, decisions);
registerMcp(app, { name: "orders", tools: ordersTools(deps), log: logger });

await app.listen({ port: config.port, host: "0.0.0.0" });
logger.info(
  { port: config.port, timer_ms: config.timerIntervalMs },
  "orders listening; board on /, MCP on /mcp",
);
