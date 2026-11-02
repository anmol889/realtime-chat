#!/usr/bin/env sh
# Tail both chat-service instances side by side. Send messages in the UI and watch one instance
# log "persisted+published" while the other one has the "subscriber attached" line for the same chat.
cd "$(dirname "$0")/.." || exit 1
exec docker compose logs -f --no-log-prefix=false chat-service-1 chat-service-2
