import { createClient, Client } from 'graphql-ws';
import WebSocket from 'ws';

export const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
export const CHAT_1 = process.env.CHAT_1_URL ?? 'http://localhost:4101';
export const CHAT_2 = process.env.CHAT_2_URL ?? 'http://localhost:4102';

export interface GqlResult<T> {
  data: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  instance: string | null;
}

export async function gql<T = any>(url: string, query: string, variables?: Record<string, unknown>): Promise<GqlResult<T>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data: T; errors?: GqlResult<T>['errors'] };
  return { ...body, instance: res.headers.get('x-instance') };
}

export function wsClient(httpUrl: string): Client {
  const url = httpUrl.replace(/^http/, 'ws');
  return createClient({ url, webSocketImpl: WebSocket, retryAttempts: 0 });
}

/** Start a subscription; `ready` resolves after the server had time to register it, `messages` collects events. */
export function subscribeMessages(client: Client, chatId: string) {
  const messages: any[] = [];
  let consumed = 0;
  const waiters: ((m: any) => void)[] = [];
  const ready = new Promise<void>((resolve) => {
    client.subscribe(
      {
        query: `subscription($chatId: ID!) { messageAdded(chatId: $chatId) { id seq senderId content } }`,
        variables: { chatId },
      },
      {
        next: (v: any) => {
          messages.push(v.data.messageAdded);
          const w = waiters.shift();
          if (w) w(messages[consumed++]);
        },
        error: (e) => console.error('subscription error', e),
        complete: () => undefined,
      },
    );
    setTimeout(resolve, 500);
  });
  /** Next not-yet-consumed message: returns immediately if it already arrived, otherwise waits. */
  const nextMessage = (timeoutMs = 10_000) =>
    new Promise<any>((resolve, reject) => {
      if (consumed < messages.length) return resolve(messages[consumed++]);
      const t = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      waiters.push((m) => {
        clearTimeout(t);
        resolve(m);
      });
    });
  return { ready, messages, nextMessage };
}

export const suffix = () => Math.random().toString(36).slice(2, 8);

export async function createUser(username: string): Promise<{ id: string; username: string }> {
  const res = await gql<{ createUser: { id: string; username: string } }>(
    `${GATEWAY}/users/graphql`,
    `mutation($input: CreateUserInput!) { createUser(input: $input) { id username } }`,
    { input: { username } },
  );
  if (res.errors) throw new Error(res.errors[0].message);
  return res.data.createUser;
}

export async function createChatWith(creatorId: string, memberIds: string[], name = `room-${suffix()}`): Promise<string> {
  const created = await gql<{ createChat: { id: string } }>(
    `${GATEWAY}/chat/graphql`,
    `mutation($input: CreateChatInput!) { createChat(input: $input) { id } }`,
    { input: { name, creatorId } },
  );
  if (created.errors) throw new Error(created.errors[0].message);
  const chatId = created.data.createChat.id;
  for (const userId of memberIds) {
    const joined = await gql(`${GATEWAY}/chat/graphql`, `mutation($c: ID!, $u: ID!) { joinChat(chatId: $c, userId: $u) { id } }`, {
      c: chatId,
      u: userId,
    });
    if (joined.errors) throw new Error(joined.errors[0].message);
  }
  return chatId;
}
