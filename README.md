# Realtime Chat

A small, horizontally scalable real-time chat system:

- **user-service** (NestJS, GraphQL, Prisma, PostgreSQL): create users, look them up.
- **chat-service** (NestJS, GraphQL + WebSocket subscriptions, Prisma, PostgreSQL, Redis): chats, membership, ordered history, live delivery.
- **web** (React, Vite, Apollo Client): sign in by username, create/join chats, chat live.
- **gateway** (nginx): one origin for the browser, round-robin over **two instances of each service**.

Everything runs in Docker with one command. The design goal is that correctness never depends on
which instance a request or WebSocket lands on.

**Contents**

1. [How to run the system](#1-how-to-run-the-system)
2. [Architecture and design choices](#2-architecture-and-design-choices)
3. [Testing approach](#3-testing-approach)
4. [Trade-offs and limitations](#4-trade-offs-and-limitations)

```
                        ┌──────────────────────────────┐
  Browser (React)  ───► │  nginx gateway  :8080        │
                        │  /              → web        │
                        │  /users/graphql → user-svc   │  round-robin, 2 upstreams
                        │  /chat/graphql  → chat-svc   │  HTTP + WebSocket upgrade
                        └──────┬───────────────┬───────┘
                               │               │
                 ┌─────────────┴───┐     ┌─────┴──────────────┐
                 │ user-service ×2 │     │ chat-service ×2    │
                 └───────┬─────────┘     └──┬──────────────┬──┘
                         │                  │              │
                   ┌─────┴─────┐      ┌─────┴─────┐  ┌─────┴─────┐
                   │ Postgres  │      │ Postgres  │  │  Redis    │
                   │ db: users │      │ db: chat  │  │ pub/sub   │
                   └───────────┘      └───────────┘  └───────────┘
```

## 1. How to run the system

**Prerequisites:** Docker Desktop (or any Docker Engine with Compose v2). Nothing else is needed
to run the stack; Node 20 + pnpm 9 are only needed to run the tests on the host.

```sh
docker compose up --build
# then open http://localhost:8080
```

What starts, in order (each step waits for the previous one to be healthy or finished):

| Step | Containers | Notes |
|---|---|---|
| 1 | `postgres`, `redis` | `infra/postgres/init.sql` creates the `users` and `chat` databases |
| 2 | `user-migrate`, `chat-migrate` | one-shot `prisma migrate deploy`, then exit |
| 3 | `user-service-1`, `user-service-2`, `chat-service-1`, `chat-service-2` | two instances of each backend |
| 4 | `web`, `gateway` | the gateway is the only container published to the host (`:8080`) |

**Try it:** open the app in two browser windows (or a normal and a private window), sign in with
two different usernames, create a chat in one, join it from the other, and chat. Messages show
their sequence number (`#1`, `#2`, …) so ordering is visible.

**See the two instances at work:**

```sh
./scripts/demo-cross-instance.sh                                   # tails chat-1 and chat-2 while you chat
curl -si http://localhost:8080/users/health | grep x-instance       # repeat: alternates user-1 / user-2
```

**Useful commands:**

| Command | What it does |
|---|---|
| `docker compose up --build -d` | start everything in the background |
| `docker compose ps` | show all containers and their health |
| `docker compose logs -f chat-service-1 chat-service-2` | watch both chat instances |
| `docker compose down -v` | stop and wipe the database volume |
| `docker compose -f docker-compose.yml -f docker-compose.test.yml up --build -d --wait` | same stack, plus each backend instance on its own host port (user 4001/4002, chat 4101/4102), used by the e2e suite |

GraphQL playgrounds (Apollo Sandbox): `http://localhost:8080/users/graphql` and `http://localhost:8080/chat/graphql`.

### Local development (optional)

Frontend with hot reload, against the full Docker stack:

```sh
corepack enable && pnpm install
docker compose up --build -d          # backends + gateway on :8080
pnpm --filter web dev                 # http://localhost:5173, proxies /users and /chat to :8080
```

Backends on the host, with only Postgres and Redis in Docker:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis   # publishes 5432 / 6379
cp apps/user-service/.env.example apps/user-service/.env
cp apps/chat-service/.env.example apps/chat-service/.env
pnpm prisma:generate
pnpm -r --filter './apps/*-service' prisma:migrate
pnpm --filter user-service start:dev  # http://localhost:4000/graphql
pnpm --filter chat-service start:dev  # http://localhost:4100/graphql
```

## 2. Architecture and design choices

Design documents:

- [docs/HLD.md](docs/HLD.md): high-level design with component, sequence and deployment diagrams, scalability and failure modes.
- [docs/LLD.md](docs/LLD.md): low-level design with module and class diagrams, data model, API contracts, algorithms and configuration.
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): the original plan and decision log (each decision with the alternatives considered), with deviations recorded.

The decisions that matter most:

### Message ordering: a per-chat sequence number assigned by the database

Each chat row carries `last_seq`. Sending a message runs one transaction:

```sql
UPDATE chats SET last_seq = last_seq + 1 WHERE id = $chat RETURNING last_seq;  -- row lock
INSERT INTO messages (chat_id, sender_id, seq, content) VALUES (...);
```

The `UPDATE` takes a row lock, so concurrent writers to the same chat, on any instance, are
serialised and get strictly increasing, gap-free `seq` values. A unique index on `(chat_id, seq)`
makes it impossible for two instances to ever persist the same position. Timestamps are not used
for ordering because two instances' clocks are not comparable at millisecond resolution.

Contention is per chat only; different chats never block each other.

### Real-time fan-out across instances: Redis Pub/Sub

After the transaction commits, the instance publishes the message to a Redis channel for that
chat. Every instance subscribes to the channels its own WebSocket clients are watching and pushes
the message down. A client connected to chat-2 therefore receives a message that chat-1 persisted,
with no sticky sessions.

Why not Postgres `LISTEN/NOTIFY`? It works and needs no extra container, but it has an 8 KB
payload limit, needs a dedicated connection per instance, and is not what you would run in
production. Why not Kafka? Far too heavy for the problem. Redis Pub/Sub is the standard,
one-line-to-swap implementation for Apollo subscriptions.

### Delivery guarantee: persist first, publish second, catch up by `seq`

Redis Pub/Sub is at-most-once in transit. That is fine because the message is already in
Postgres before it is published, and clients can always recover:

- the frontend keeps a `seq`-keyed map, so a message that arrives twice (history and live) collapses;
- any hole inside the loaded range (we hold `#7` and `#9` but not `#8`) is detected and fetched immediately;
- after a WebSocket reconnect the client fetches `messages(afterSeq: maxSeqSeen)`.

So a Redis blip or an instance restart pauses live delivery briefly but never loses or reorders a message.

### Service boundaries

- Each service owns its own database (`users`, `chat`) inside one Postgres container. No shared tables.
- chat-service stores only `senderId`. It calls user-service **once, at join time**, to verify the
  user exists (fail-closed with `UPSTREAM_UNAVAILABLE` if user-service is down). The hot path
  (send, history, subscription) never calls another service. The frontend resolves display names
  with one batched `users(ids)` query.
- Service-to-service calls go through the same nginx gateway, so they are load balanced too.

### Multiple instances in Compose

Two named containers per service (`chat-service-1`, `chat-service-2`, …) via YAML anchors, rather
than `deploy.replicas`, so they are visible in `docker ps` and logs and the e2e suite can target
each one. Migrations run in one-shot `*-migrate` jobs that the app containers wait on, so two
instances booting at once never race on schema changes. Every response carries an `x-instance`
header so round-robin is observable.

### Frontend

One Apollo client. Both GraphQL APIs are on the same origin behind nginx, so an operation picks its
backend by path (`context: { service: 'users' }`); subscriptions go over `graphql-ws` to
`/chat/graphql`. Sends are optimistic (`clientMessageId`), and the server treats a retry with the
same id as idempotent, returning the original message without burning a sequence number.

### Stack and tooling

TypeScript everywhere. NestJS 11 with code-first GraphQL on Apollo Server 5, `graphql-ws` for
subscriptions, Prisma 6 with explicit SQL migrations, React 19 + Vite + Apollo Client 3, pnpm
workspaces, multi-stage Alpine Dockerfiles using `pnpm deploy` for small production images.

Repository layout:

```
apps/user-service        NestJS + GraphQL + Prisma (db: users)
apps/chat-service        NestJS + GraphQL + subscriptions + Prisma + Redis (db: chat)
apps/web                 React + Vite + Apollo Client
e2e/                     cross-instance API test (Jest) + two-browser UI test (Playwright)
infra/nginx              gateway config (round-robin, WebSocket upgrade)
infra/postgres           creates the two databases
scripts/                 demo-cross-instance.sh
docs/                    HLD, LLD, implementation plan and decision log
.github/workflows        CI: lint, typecheck, unit, integration, full stack + e2e
docker-compose.yml       the whole system (2 instances of each backend)
docker-compose.test.yml  overlay: exposes each instance for e2e
docker-compose.dev.yml   overlay: exposes Postgres/Redis for host development
```

## 3. Testing approach

Tests are layered so each requirement is proven at the cheapest level that can prove it, and the
multi-instance requirement is proven twice: in-process (integration) and against the real Docker
stack (end-to-end).

| Layer | Where | Tool | What it proves |
|---|---|---|---|
| Unit | `apps/*/src/**/*.spec.ts`, `apps/web/src/lib/*.test.ts` | Jest, Vitest | Service logic with a fake Prisma/PubSub: persist-then-publish order, membership rejection, idempotent retry, paging; frontend timeline ordering, dedupe, gap detection, optimistic reconciliation; the GraphQL schema exposes the expected operations. |
| Integration | `apps/*/test/integration` | Jest + Testcontainers (real Postgres, real Redis) | user-service: uniqueness enforced by the DB, validation, health. chat-service: **two Nest instances booted in the same process**, sharing Postgres + Redis: a message sent via instance A arrives at a subscriber on instance B; 40 concurrent sends across both instances yield `seq` 1..40 with no gaps; paging; FORBIDDEN burns no seq; idempotency. |
| End-to-end (API) | `e2e/api` | Jest + `graphql-ws` against the Compose stack | **The required flow**: subscribe on `chat-service-2`, send through `chat-service-1`, receive it (and the reverse); sends through the gateway land on both instances and stay ordered; both user-service instances answer. |
| End-to-end (UI) | `e2e/ui` | Playwright, two browser contexts | Two users chat live in both directions; after a reload, history order equals live order. |

Run them:

```sh
pnpm install && pnpm prisma:generate
pnpm test                 # unit (both services + web)
pnpm test:int             # integration (needs Docker for Testcontainers)

docker compose -f docker-compose.yml -f docker-compose.test.yml up --build -d --wait
pnpm test:e2e                                             # cross-instance API flow
pnpm --filter e2e exec playwright install chromium        # first time only
pnpm test:e2e:ui                                          # two-browser UI flow
docker compose down -v
```

`.github/workflows/ci.yml` runs the same sequence on every push: lint, typecheck, unit, build,
integration, then the full stack and both e2e suites.

## 4. Trade-offs and limitations

- **No authentication.** `userId` is client-supplied. The obvious next step is a JWT issued by user-service, checked at the gateway, and a `@CurrentUser()` decorator replacing the `senderId` argument.
- **Per-chat row lock serialises writers to one chat.** Fine for human-speed conversation; a very hot chat would need a different design (partitioned sequences or a log).
- **Redis Pub/Sub is not durable.** Mitigated client-side via `seq` catch-up rather than with a durable broker. Nothing is lost, but a subscriber can see a short delay after a Redis outage.
- **Chat list is polled** (every 3 s) rather than subscribed; a per-user subscription would be the next step for a multi-room UI with unread counts.
- **Single Postgres and single Redis.** The backends scale horizontally; the data tier is a single node in this demo.
- **Shared code is duplicated** (error classes, Prisma module) between the two services instead of being a workspace package. Deliberate: it keeps each service independently buildable and deployable, and the duplicated code is ~60 lines.
- **`seq` is a 32-bit integer** (2 billion messages per chat). Enough here; `BIGINT` is a one-line migration if ever needed.
