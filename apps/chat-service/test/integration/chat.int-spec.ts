import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'child_process';
import { createClient, Client } from 'graphql-ws';
import request from 'supertest';
import WebSocket from 'ws';

/**
 * Integration tests against real Postgres + Redis (Testcontainers).
 *
 * Two independent Nest applications are booted from the same module (instance A and instance B)
 * sharing the same database and Redis, exactly like two replicas behind the load balancer.
 * This lets us prove the two properties the challenge cares about without docker-compose:
 *   1. a message sent through instance A is delivered live to a subscriber on instance B;
 *   2. concurrent sends spread across both instances get gap-free, unique `seq` values.
 */
describe('chat-service (integration, 2 instances)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let appA: INestApplication;
  let appB: INestApplication;
  let portA: number;
  let portB: number;
  const userA = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
  const userB = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
  const stranger = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';

  const gql = (app: INestApplication, query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/graphql').send({ query, variables });

  async function boot(): Promise<{ app: INestApplication; port: number }> {
    // Imported lazily: ConfigModule validates process.env when app.module is first loaded.
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    return { app, port };
  }

  function wsClient(port: number): Client {
    return createClient({ url: `ws://127.0.0.1:${port}/graphql`, webSocketImpl: WebSocket, retryAttempts: 0 });
  }

  /** Subscribe and resolve once the server has acknowledged with the first `next` or after it is wired. */
  function subscribeOnce(client: Client, chatId: string): { next: Promise<any>; ready: Promise<void> } {
    let resolveNext!: (v: any) => void;
    let rejectNext!: (e: any) => void;
    const next = new Promise<any>((res, rej) => {
      resolveNext = res;
      rejectNext = rej;
    });
    const ready = new Promise<void>((res) => {
      client.subscribe(
        {
          query: `subscription($chatId: ID!) { messageAdded(chatId: $chatId) { id chatId senderId seq content createdAt } }`,
          variables: { chatId },
        },
        { next: (v) => resolveNext(v), error: (e) => rejectNext(e), complete: () => undefined },
      );
      // graphql-ws has no "subscribed" ack; give the server a moment to register the Redis channel.
      setTimeout(res, 400);
    });
    return { next, ready };
  }

  async function createChatWithMembers(app: INestApplication): Promise<string> {
    const created = await gql(
      app,
      `mutation($input: CreateChatInput!) { createChat(input: $input) { id memberIds } }`,
      { input: { name: 'general', creatorId: userA } },
    );
    expect(created.body.errors).toBeUndefined();
    const chatId: string = created.body.data.createChat.id;
    const joined = await gql(app, `mutation($c: ID!, $u: ID!) { joinChat(chatId: $c, userId: $u) { memberIds } }`, {
      c: chatId,
      u: userB,
    });
    expect(joined.body.data.joinChat.memberIds.sort()).toEqual([userA, userB].sort());
    return chatId;
  }

  beforeAll(async () => {
    // Started sequentially: Docker Desktop occasionally fails host-port lookup for parallel starts.
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    redis = await new RedisContainer('redis:7-alpine').start();
    Object.assign(process.env, {
      DATABASE_URL: pg.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
      USER_SERVICE_URL: 'http://user-service.invalid/graphql',
      VERIFY_USERS: 'false',
      INSTANCE_ID: 'chat-int',
      PORT: '0',
    });
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
    ({ app: appA, port: portA } = await boot());
    ({ app: appB, port: portB } = await boot());
  });

  afterAll(async () => {
    await Promise.all([appA?.close(), appB?.close()]);
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('delivers a message sent via instance A to a subscriber on instance B (and vice versa)', async () => {
    const chatId = await createChatWithMembers(appA);

    const clientB = wsClient(portB);
    const subB = subscribeOnce(clientB, chatId);
    await subB.ready;

    const sent = await gql(appA, `mutation($i: SendMessageInput!) { sendMessage(input: $i) { id seq content } }`, {
      i: { chatId, senderId: userA, content: 'hello from A' },
    });
    expect(sent.body.errors).toBeUndefined();
    const received = await subB.next;
    expect(received.data.messageAdded).toMatchObject({ id: sent.body.data.sendMessage.id, seq: 1, content: 'hello from A' });
    expect(typeof received.data.messageAdded.createdAt).toBe('string');
    await clientB.dispose();

    const clientA = wsClient(portA);
    const subA = subscribeOnce(clientA, chatId);
    await subA.ready;
    const sent2 = await gql(appB, `mutation($i: SendMessageInput!) { sendMessage(input: $i) { id seq } }`, {
      i: { chatId, senderId: userB, content: 'hello from B' },
    });
    const received2 = await subA.next;
    expect(received2.data.messageAdded).toMatchObject({ id: sent2.body.data.sendMessage.id, seq: 2 });
    await clientA.dispose();
  });

  it('assigns gap-free unique seq under concurrent sends across both instances', async () => {
    const chatId = await createChatWithMembers(appA);
    const N = 40;
    const sends = Array.from({ length: N }, (_, i) =>
      gql(i % 2 === 0 ? appA : appB, `mutation($i: SendMessageInput!) { sendMessage(input: $i) { seq } }`, {
        i: { chatId, senderId: i % 2 === 0 ? userA : userB, content: `m${i}` },
      }),
    );
    const results = await Promise.all(sends);
    for (const r of results) expect(r.body.errors).toBeUndefined();

    const history = await gql(appB, `query($c: ID!) { messages(chatId: $c, limit: 200) { seq } }`, { c: chatId });
    const seqs: number[] = history.body.data.messages.map((m: { seq: number }) => m.seq);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    const chat = await gql(appA, `query($c: ID!) { chat(id: $c) { lastSeq } }`, { c: chatId });
    expect(chat.body.data.chat.lastSeq).toBe(N);
  });

  it('supports catch-up (afterSeq) and load-older (beforeSeq) paging', async () => {
    const chatId = await createChatWithMembers(appA);
    for (let i = 1; i <= 5; i++) {
      await gql(appA, `mutation($i: SendMessageInput!) { sendMessage(input: $i) { seq } }`, {
        i: { chatId, senderId: userA, content: `m${i}` },
      });
    }
    const after = await gql(appB, `query($c: ID!) { messages(chatId: $c, afterSeq: 3) { seq } }`, { c: chatId });
    expect(after.body.data.messages.map((m: any) => m.seq)).toEqual([4, 5]);
    const before = await gql(appB, `query($c: ID!) { messages(chatId: $c, beforeSeq: 4, limit: 2) { seq } }`, { c: chatId });
    expect(before.body.data.messages.map((m: any) => m.seq)).toEqual([2, 3]);
  });

  it('rejects non-members with FORBIDDEN and burns no seq', async () => {
    const chatId = await createChatWithMembers(appA);
    const res = await gql(appA, `mutation($i: SendMessageInput!) { sendMessage(input: $i) { seq } }`, {
      i: { chatId, senderId: stranger, content: 'intruder' },
    });
    expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    const chat = await gql(appA, `query($c: ID!) { chat(id: $c) { lastSeq } }`, { c: chatId });
    expect(chat.body.data.chat.lastSeq).toBe(0);
  });

  it('treats a retry with the same clientMessageId as idempotent', async () => {
    const chatId = await createChatWithMembers(appA);
    const mutation = `mutation($i: SendMessageInput!) { sendMessage(input: $i) { id seq clientMessageId } }`;
    const input = { chatId, senderId: userA, content: 'once', clientMessageId: 'client-abc' };
    const first = await gql(appA, mutation, { i: input });
    const second = await gql(appB, mutation, { i: input });
    expect(second.body.errors).toBeUndefined();
    expect(second.body.data.sendMessage).toEqual(first.body.data.sendMessage);
    const history = await gql(appA, `query($c: ID!) { messages(chatId: $c) { seq } }`, { c: chatId });
    expect(history.body.data.messages).toHaveLength(1);
  });
});
