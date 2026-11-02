# Implementation Plan: Scalable Real-Time Chat

Plan for the "Scalable Real-Time Chat" coding challenge: two NestJS GraphQL backend services, one React frontend, PostgreSQL,
everything started with `docker-compose` and running 2+ instances of each backend. The emphasis of the challenge is **reasoning**, so every section records the
decision, the alternatives considered, and why the chosen option wins.

---

## 1. Goals and non-goals

**Must have (from the brief)**
- User Service: create user, get user info.
- Chat Service: create/join chats, send messages, store history, deliver messages live.
- Both backends run as 2+ instances behind a load balancer; correctness must not depend on which instance a client hits.
- Messages appear in the correct order on every client.
- React + GraphQL frontend: chat history + live send/receive.
- Docker Compose brings up the whole thing with one command.
- At least one tested end-to-end flow (send on one instance, receive on another).
- README with run instructions, architecture, testing approach, trade-offs.

**Explicit non-goals (kept out to stay focused; listed in README as limitations)**
- Authentication / authorization (a `userId` header is trusted).
- Read receipts, typing indicators, presence, file attachments.
- Message edit/delete.
- Horizontal scaling of PostgreSQL / Redis themselves.

---

## 2. High-level architecture

```
                        ┌──────────────────────────────┐
  Browser (React)  ───► │  nginx gateway  :8080        │
                        │  /            → web          │
                        │  /users/graphql → user-svc   │  (round-robin, 2 upstreams)
                        │  /chat/graphql  → chat-svc   │  (HTTP + WebSocket upgrade)
                        └──────┬───────────────┬───────┘
                               │               │
                 ┌─────────────┴───┐     ┌─────┴──────────────┐
                 │ user-service ×2 │     │ chat-service ×2    │
                 │ NestJS/GQL      │     │ NestJS/GQL+WS      │
                 └───────┬─────────┘     └──┬──────────────┬──┘
                         │                  │              │
                   ┌─────┴─────┐      ┌─────┴─────┐  ┌─────┴─────┐
                   │ Postgres  │      │ Postgres  │  │  Redis    │
                   │ db: users │      │ db: chat  │  │ pub/sub   │
                   └───────────┘      └───────────┘  └───────────┘
```

### Key decisions

| # | Decision | Chosen | Alternatives considered | Why |
|---|----------|--------|-------------------------|-----|
| D1 | Cross-instance real-time fan-out | **Redis Pub/Sub** via `graphql-redis-subscriptions` | (a) Postgres `LISTEN/NOTIFY`, (b) sticky sessions only, (c) Kafka | (b) is wrong: a sender on instance A must reach a subscriber on instance B. (a) works and needs no extra container, but has an 8 KB payload limit, one listening connection per instance, and is not what you'd run in production. (c) is overkill for a chat demo. Redis is the standard, one-line-to-swap `PubSub` implementation for Apollo subscriptions. |
| D2 | Message ordering | **Per-chat monotonic `seq` assigned in the DB** inside the insert transaction | (a) `created_at` timestamp, (b) client-generated IDs, (c) global sequence | Timestamps from two instances are not comparable (clock skew, equal ms). A per-chat counter updated with `UPDATE chats SET last_seq = last_seq + 1 ... RETURNING last_seq` serialises writers on the chat row, so `seq` is a total order per chat regardless of instance. Clients sort/dedupe by `seq`. |
| D3 | Delivery guarantee | **Persist first, then publish; client catches up by `seq` on (re)connect** | Publish before persist; at-least-once broker | Redis Pub/Sub is fire-and-forget. If a subscriber instance misses a publish, the message is still in Postgres. The client fetches `messages(chatId, afterSeq)` on subscription start and on every reconnect, so nothing is lost; duplicates are removed by `seq`. |
| D4 | Datastore per service | **One Postgres container, two databases** (`users`, `chat`) | Shared schema; two containers | Services never share tables (service-owns-its-data), but one container keeps `docker-compose` light. |
| D5 | ORM / migrations | **Prisma** with explicit SQL migrations, applied by one-shot `user-migrate` / `chat-migrate` Compose jobs (`prisma migrate deploy`) | TypeORM `synchronize`, migrate-on-boot in every instance | Two instances booting at once must not race on migrations. Running them once, in a dedicated job the app containers wait on (`service_completed_successfully`), removes the race entirely. Prisma's typed client and readable SQL migration files are easy to review. |
| D6 | Service-to-service dependency | **Chat Service stores only `senderId`; frontend resolves user names from User Service** | Chat Service calls User Service on every send | Keeps Chat Service free of a runtime dependency on User Service (resilience + simpler tests). Membership join validates the user once via a GraphQL call to User Service with a short timeout (demonstrates inter-service call without putting it on the hot path). |
| D7 | Load balancing | **nginx** with two explicit upstreams per service and WebSocket upgrade headers | Compose `deploy.replicas` + Docker DNS | Explicit `chat-service-1` / `chat-service-2` (via YAML anchors) are visible in `docker ps` and logs, which makes "it works across instances" demonstrable. nginx handles `/chat/graphql` WS upgrade; no sticky sessions needed because of D1. |
| D8 | GraphQL style | **Code-first** NestJS (`@nestjs/graphql` + Apollo); the printed `schema.gql` is committed | Schema-first SDL | Types, validation decorators and resolvers live together in TypeScript; the generated `schema.gql` is still the reviewable contract the frontend is written against, and a schema unit test fails if an operation disappears. |
| D9 | Frontend data layer | **Apollo Client**, single client, `split` link: WS for subscriptions, HTTP otherwise; operation context picks the service path | Two Apollo clients; urql | One cache, one provider. The gateway (D7) puts both services on the same origin so there is no CORS. |
| D10 | Monorepo tooling | **pnpm workspaces** (`apps/*`, `e2e`) | Nx, Turborepo, npm workspaces | Strict, fast, disk-efficient installs; `pnpm deploy` produces a self-contained production folder per service for small Docker images. Nx/Turbo add caching and graph tooling this repo does not need. |
| D11 | Runtime | **Docker containers for everything**, orchestrated by Docker Compose v2; no service is run on the host | Run services on the host (`pnpm start:dev`, `pnpm dev`) and only infra in Docker | The brief requires Docker and "multiple instances". Containerising the apps themselves is the only way to show 2 real instances of each service behind a load balancer, and guarantees the reviewer gets the same environment with one `docker compose up --build`; the Node toolchain lives inside the image build, so the host needs only Docker. Host mode is kept only as a developer convenience (`docker compose up -d postgres redis`). |

---

### Prerequisites (local machine)

- Docker Desktop 4.x+ (Docker Engine 29, Compose v2). Compose v2 is required for `depends_on: condition: service_completed_successfully`.
- Node 20 + pnpm 9 for running tests outside containers; Docker for Testcontainers-based integration tests. The stack itself needs nothing but Docker.
- macOS note: if `docker` is not on PATH, add `/Applications/Docker.app/Contents/Resources/bin` to it or let Docker Desktop install the symlinks.


## 3. Repository layout

```
realtime-chat/
├── apps/
│   ├── user-service/          # NestJS + GraphQL + Prisma (db: users)
│   ├── chat-service/          # NestJS + GraphQL + WS subscriptions + Prisma + Redis (db: chat)
│   └── web/                   # React + Vite + Apollo Client
├── packages/
│   └── graphql-types/         # (planned, dropped: see section 13)
├── infra/
│   ├── nginx/gateway.conf
│   └── postgres/init.sql      # creates `users` and `chat` databases
├── e2e/                       # cross-instance end-to-end tests (Playwright + graphql-ws)
├── docker-compose.yml
├── docker-compose.test.yml    # overrides for CI / e2e
├── pnpm-workspace.yaml        # apps/* + e2e
├── package.json
└── README.md
```

---

## 4. Data model

### 4.1 User Service (`users` db)

```sql
users (
  id          uuid primary key default gen_random_uuid(),
  username    text not null unique,
  display_name text not null,
  created_at  timestamptz not null default now()
)
```

### 4.2 Chat Service (`chat` db)

```sql
chats (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  last_seq   bigint not null default 0,          -- D2: per-chat counter
  created_at timestamptz not null default now()
)

chat_members (
  chat_id    uuid references chats(id) on delete cascade,
  user_id    uuid not null,                       -- D6: no FK across services
  joined_at  timestamptz not null default now(),
  primary key (chat_id, user_id)
)

messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references chats(id) on delete cascade,
  sender_id  uuid not null,
  seq        bigint not null,                     -- D2
  content    text not null check (length(content) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique (chat_id, seq)                           -- ordering + idempotency guard
)
create index messages_chat_seq_idx on messages (chat_id, seq);   -- history pagination
```

**Send-message transaction (the heart of D2):**

```sql
begin;
update chats set last_seq = last_seq + 1 where id = $chatId returning last_seq;  -- row lock
insert into messages (chat_id, sender_id, seq, content) values (...);
commit;
-- then: redis PUBLISH chat:<chatId> <message json>
```

Two instances sending to the same chat concurrently block on the `chats` row lock, so `seq`
values are strictly increasing and gap-free per chat. Contention is per-chat only.

---

## 5. GraphQL API

### 5.1 User Service — `/users/graphql`

```graphql
type User { id: ID!, username: String!, displayName: String!, createdAt: DateTime! }

type Query {
  user(id: ID!): User
  userByUsername(username: String!): User
  users(ids: [ID!]!): [User!]!          # batch lookup for the frontend (DataLoader-friendly)
}
type Mutation {
  createUser(input: CreateUserInput!): User!
}
```

### 5.2 Chat Service — `/chat/graphql` (HTTP + WS)

```graphql
type Chat    { id: ID!, name: String!, memberIds: [ID!]!, lastSeq: Int!, createdAt: DateTime! }
type Message { id: ID!, chatId: ID!, senderId: ID!, seq: Int!, content: String!, createdAt: DateTime! }

type Query {
  chats: [Chat!]!
  chat(id: ID!): Chat
  messages(chatId: ID!, afterSeq: Int = 0, limit: Int = 50): [Message!]!   # cursor = seq (D3)
}
type Mutation {
  createChat(name: String!): Chat!
  joinChat(chatId: ID!, userId: ID!): Chat!
  sendMessage(chatId: ID!, senderId: ID!, content: String!, clientMessageId: ID): Message!
}
type Subscription {
  messageAdded(chatId: ID!): Message!
}
```

- `sendMessage` requires sender to be a member (membership check inside the same transaction).
- `clientMessageId` (optional) enables optimistic UI + safe retry on the client.
- Subscription transport: `graphql-ws` (not the deprecated `subscriptions-transport-ws`).

---

## 6. Frontend behaviour (React)

Screens (single page, minimal styling):
1. **Login / create user** — enter username, call `createUser` or `userByUsername`; store `userId` in `localStorage`.
2. **Chat list** — `chats`, `createChat`, `joinChat`.
3. **Chat room** — history + live messages + composer.

**Chat room data flow (order matters, this is how we avoid gaps):**
1. Open the `messageAdded(chatId)` subscription **first**.
2. Then query `messages(chatId, afterSeq: 0, limit: 50)` for history.
3. Merge both streams into a `Map<seq, Message>`; render sorted by `seq`. Duplicates collapse naturally.
4. On WS reconnect (Apollo `graphql-ws` `on.connected` with `isReconnect`), re-query `messages(afterSeq: maxSeqSeen)` to backfill anything missed.
5. Sender names come from a `users(ids)` batch query, cached by Apollo.

Optimistic send: append a pending message locally keyed by `clientMessageId`, replace it when the
server message with the same `clientMessageId` arrives.

---

## 7. Docker Compose topology

```yaml
services:
  postgres:        # image postgres:16, init.sql creates `users` and `chat` dbs, healthcheck pg_isready
  redis:           # image redis:7-alpine, healthcheck redis-cli ping

  user-migrate:    # one-shot: prisma migrate deploy (db: users), then exits 0
  chat-migrate:    # one-shot: prisma migrate deploy (db: chat), then exits 0

  user-service-1:  # &user-service anchor; depends_on postgres healthy + user-migrate completed
  user-service-2:  # <<: *user-service

  chat-service-1:  # &chat-service anchor; INSTANCE_ID=chat-1 env (surfaced in logs + an `x-instance` header for demos)
  chat-service-2:  # <<: *chat-service, INSTANCE_ID=chat-2

  web:             # multi-stage build: vite build → nginx static
  gateway:         # nginx, ports 8080:80, routes / → web, /users/graphql → user-service-{1,2}, /chat/graphql → chat-service-{1,2} (WS upgrade)
```

Each backend image: multi-stage Dockerfile with the repository root as build context
(`pnpm install --frozen-lockfile --filter <service>` as a cached layer → `prisma generate` +
`nest build` → `pnpm deploy --prod` → `node:20-alpine` runtime as the unprivileged `node` user).
The migrate jobs reuse the same image with `prisma migrate deploy` as the command. Health
endpoints (`/health`, `@nestjs/terminus` pinging the database) gate compose `depends_on`.

A `scripts/demo-cross-instance.sh` script tails logs of `chat-service-1` and `chat-service-2`
while sending a message, so a reviewer can **see** the message persisted on one instance and
delivered from the other.

---

## 8. Testing strategy

| Layer | Tool | What it proves |
|-------|------|----------------|
| Unit | Jest | `MessageService` ordering/dedupe helpers, resolver input validation, `UserService` uniqueness handling. Pure logic, no DB. |
| Integration (per service) | Jest + real Postgres via `@testcontainers/postgresql` (or compose `test` profile) | (1) `sendMessage` assigns strictly increasing, gap-free `seq` under 50 concurrent sends to the same chat from parallel calls; (2) `messages(afterSeq)` pagination; (3) non-member cannot send; (4) `createUser` unique username → proper GraphQL error. |
| End-to-end (**the required flow**) | Jest + `graphql-ws` client + `graphql-request` against the running compose stack | Subscribe to `messageAdded` **through instance chat-service-2 directly** (port exposed only in `docker-compose.test.yml`), send via **instance chat-service-1**, assert the message arrives with the right `seq`. This is the single test that proves multi-instance correctness. |
| Browser e2e | Playwright | Two browser contexts (two users) in the same chat: user A sends, user B sees it live; reload B and verify history order == live order. |

CI (`.github/workflows/ci.yml`): lint → unit → integration → `docker compose up --build -d` → e2e → `down`.

---

## 9. Implementation phases

Each phase ends in a runnable, committed state.

### Phase 0 — Scaffold (½ day)
- `pnpm` workspace, root ESLint/Prettier/TS config, `.editorconfig`, `.nvmrc`.
- `nest new` for both services; Vite React TS for `web`.
- `docker-compose.yml` with postgres + redis + init.sql only; verify `docker compose up`.
- README skeleton with the section headings from the brief.

### Phase 1 — User Service (½ day)
- Prisma schema + first migration; `PrismaService`.
- `UsersModule`: resolver, service, DTOs with `class-validator`.
- Unique-username conflict → `ConflictException` mapped to GraphQL error with `code`.
- `/health` endpoint. Dockerfile. `user-migrate`, `user-service-1/2` in compose.
- Unit + integration tests.

### Phase 2 — Chat Service core (1 day)
- Prisma schema (chats, chat_members, messages) + migration with the `(chat_id, seq)` unique index.
- `ChatsModule` (create/join/list) and `MessagesModule` (send/history).
- `sendMessage` transaction with `last_seq` increment (D2). Membership check.
- `clientMessageId` idempotency (optional unique index `(chat_id, sender_id, client_message_id)`).
- Dockerfile, `chat-migrate`, `chat-service-1/2` in compose.
- Integration test for concurrent sequence assignment.

### Phase 3 — Real-time fan-out (½ day)
- `graphql-ws` subscriptions in `GraphQLModule`.
- `RedisPubSub` provider; publish after commit; `messageAdded` resolver filters by `chatId`.
- `INSTANCE_ID` logging on publish and on deliver.
- Cross-instance e2e test (Section 8) + `docker-compose.test.yml` exposing instance ports.

### Phase 4 — Gateway (¼ day)
- nginx config: upstreams, `proxy_http_version 1.1`, `Upgrade`/`Connection` headers for `/chat/graphql`, timeouts raised for WS, `X-Instance` response header passthrough.
- Verify both HTTP round-robin and WS through gateway.

### Phase 5 — Frontend (1 day)
- Apollo Client with `split` link (WS vs HTTP) + `graphql-ws` client with reconnect.
- GraphQL codegen into `packages/graphql-types`.
- Screens from Section 6; subscription-before-history merge logic in a small hook `useChatMessages(chatId)`; unit test the merge/dedupe reducer.
- Optimistic send; reconnect backfill.
- Dockerfile (vite build → nginx), add `web` to compose.

### Phase 6 — Browser e2e, polish, docs (½ day)
- Playwright two-user test.
- `scripts/demo-cross-instance.sh`.
- README: run instructions, architecture (diagram above), decisions table, testing, trade-offs.
- Final `docker compose up --build` from a clean clone.

Total: ~4 working days.

---

## 10. Conventions

- Commits per phase; Conventional Commits (`feat(chat): ...`).
- Env config via `@nestjs/config` with a validated schema (`joi`); `.env.example` committed.
- Errors: domain exceptions mapped to GraphQL `extensions.code` (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `BAD_USER_INPUT`, `UPSTREAM_UNAVAILABLE`).
- Logging: `pino` (nestjs-pino) with `instanceId` in every line.

---

## 11. Trade-offs and limitations (to state in README)

- **Redis Pub/Sub is at-most-once in transit.** Mitigated by persist-first + seq-based catch-up (D3), not by a durable broker. Under a Redis outage, live delivery pauses but nothing is lost; clients recover on reconnect.
- **Per-chat row lock** serialises writers to one chat. Fine for human-speed chat; a very hot chat would need partitioned sequences or a log-based design.
- **No auth.** `userId` is client-supplied. Adding JWT at the gateway and a `@CurrentUser()` decorator is the obvious next step.
- **Membership is checked only in Chat Service.** User existence is verified at join time, not on every send (D6).
- **Single Postgres / single Redis.** Backends scale horizontally; the data tier is a single node in this demo.
- **Subscription per chat room.** Fine for the UI here; a multi-room sidebar with unread counts would want a per-user subscription instead.

---

## 12. Open questions / optional stretch

- Pagination of chat list and "load older messages" (`beforeSeq`) — cheap with the `(chat_id, seq)` index; add if time permits.
- Replace `users(ids)` frontend batch with a GraphQL federation gateway (Apollo Router) — intentionally skipped; the nginx gateway + explicit paths is simpler to review.
- Rate limiting at gateway (`limit_req`) — one-liner in nginx if desired.

---

## 13. Deviations from this plan (recorded during implementation)

| Plan said | What was built | Why |
|---|---|---|
| `seq` / `last_seq` as `bigint` | `INTEGER` (32-bit) | Keeps `seq` a plain JS `number` and a GraphQL `Int`; 2 billion messages per chat is far beyond demo scope. One-line migration if ever needed. |
| `packages/graphql-types` with GraphQL codegen | Hand-written TS types next to the `gql` documents in `apps/web/src/graphql/operations.ts` | Six operations do not justify a codegen pipeline; one less moving part for a reviewer to set up. |
| Client subscribes *before* fetching history to avoid gaps | Client subscribes and fetches concurrently; **gap detection by `seq`** (`missingRanges`) fetches any hole immediately, plus `afterSeq` catch-up on reconnect | `graphql-ws` gives no "subscribed" acknowledgement, so strict ordering is not achievable; `seq` being gap-free makes gaps *detectable*, which is a stronger guarantee than ordering two requests. |
| `pino` structured logging | Nest's built-in `Logger` with `[instance-id]` prefix | Enough to demonstrate which instance handled what; fewer dependencies. |
| Apollo Server 4 | Apollo Server 5 + `@as-integrations/express5` | NestJS 11 runs on Express 5, and `@nestjs/apollo` 13 requires the v5 server. |
| Shared `packages/` for common code | Error classes and the Prisma module are duplicated (~60 lines) in both services | Keeps each service independently buildable with `pnpm deploy`; a shared package would need its own build step inside every Docker image. |
| Playwright-only e2e | Two e2e suites: a Jest + `graphql-ws` API suite that targets each chat instance directly, and the Playwright two-browser suite | The API suite is the clearest proof of the cross-instance requirement; the browser suite proves the real user path. |
| Prisma default client location | `output = "./generated/client"` per service | In a pnpm workspace the default location is shared, so the two services overwrote each other's generated client. |
