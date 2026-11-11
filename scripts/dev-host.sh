#!/usr/bin/env bash
# Runs the 7 services and 6 agents as host processes (no image build), against Postgres and RabbitMQ
# from compose: `docker compose up -d postgres rabbitmq` first. Logs go to .dev-logs/<name>.log.
#
#   bash scripts/dev-host.sh            start all; Ctrl+C stops all
#   AGENT_MODE=scripted bash scripts/dev-host.sh
#   PG=127.0.0.1:5433 AMQP=127.0.0.1:5672 bash scripts/dev-host.sh   other infra addresses
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

PG="${PG:-127.0.0.1:55432}"
AMQP="${AMQP:-127.0.0.1:55672}"
export AMQP_URL="amqp://ac:ac@${AMQP}"
export DECISIONS_DATABASE_URL="postgres://ac:ac@${PG}/decisions"
export ORDERS_MCP=http://127.0.0.1:3001/mcp CUSTOMERS_MCP=http://127.0.0.1:3005/mcp CATALOGUE_MCP=http://127.0.0.1:3003/mcp
export SHIPPING_MCP=http://127.0.0.1:3004/mcp PAYMENT_MCP=http://127.0.0.1:3006/mcp EMAIL_MCP=http://127.0.0.1:3002/mcp
export CUSTOMERS_URL=http://127.0.0.1:3005 PUBLIC_BASE_URL_ORDERS=http://localhost:3001
mkdir -p .dev-logs
pids=()

run() { # name port db command...
  local name=$1 port=$2 db=$3; shift 3
  PORT=$port DATABASE_URL="postgres://ac:ac@${PG}/${db}" "$@" >".dev-logs/${name}.log" 2>&1 &
  pids+=($!)
  echo "started ${name} (pid $!, port ${port})"
}

run customers      3005 customers node services/customers/src/main.ts
run catalogue-mock 3003 catalogue node services/catalogue-mock/src/main.ts
run orders         3001 orders    node services/orders/src/main.ts
run email          3002 email     node services/email/src/main.ts
run shipping-mock  3004 shipping  node services/shipping-mock/src/main.ts
run payment-mock   3006 payment   node services/payment-mock/src/main.ts
run chat-ui        3000 -         node services/chat-ui/src/main.ts
sleep 2
MCP_SERVERS=$CATALOGUE_MCP,$ORDERS_MCP run agent-shopping     0 - node agents/shopping/main.ts
MCP_SERVERS=$ORDERS_MCP,$CATALOGUE_MCP run agent-offer        0 - node agents/offer/main.ts
MCP_SERVERS=$CATALOGUE_MCP run agent-inventory                0 - node agents/inventory/main.ts
MCP_SERVERS=$ORDERS_MCP,$EMAIL_MCP run agent-notification     0 - node agents/notification/main.ts
MCP_SERVERS=$SHIPPING_MCP run agent-shipping                  0 - node agents/shipping/main.ts
MCP_SERVERS=$PAYMENT_MCP run agent-payment                    0 - node agents/payment/main.ts

trap 'echo "stopping"; kill "${pids[@]}" 2>/dev/null; exit 0' INT TERM
echo "all started; logs in .dev-logs/ (npx pino-pretty < .dev-logs/orders.log). Ctrl+C stops."
wait
