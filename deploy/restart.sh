#!/bin/sh
# Starts the web app again with the current .env, without building anything, and waits until
# it is healthy. Run it after ./set-secret.sh or any other change to .env.
set -eu
cd "$(dirname "$0")"
docker compose up -d --force-recreate --no-deps web
id=$(docker compose ps -q web)
status=starting
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  sleep 5
done
echo "web is $status"
[ "$status" = healthy ]
