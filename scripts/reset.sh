#!/usr/bin/env bash
# Starts the demo again from the seed data: removes the Postgres volume (all 7 databases) and the
# RabbitMQ queues, then starts all 15 containers. Use it between two demos.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose down --volumes --remove-orphans
docker compose up --build -d
echo "reset done: seed data only. Pages: chat :3000, board :3001, inbox :3002, manager :3003, courier :3004, RabbitMQ :15672"
