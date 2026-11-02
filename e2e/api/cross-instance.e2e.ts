import { CHAT_1, CHAT_2, GATEWAY, createChatWith, createUser, gql, subscribeMessages, suffix, wsClient } from './client';

/**
 * THE required end-to-end flow, run against the real docker-compose stack:
 * a message sent through one chat-service instance is received live by a client that is
 * subscribed on the *other* instance, and history comes back in order from any instance.
 *
 * Requires: docker compose -f docker-compose.yml -f docker-compose.test.yml up --build -d
 */
describe('cross-instance real-time delivery', () => {
  let alice: { id: string };
  let bob: { id: string };

  beforeAll(async () => {
    const s = suffix();
    alice = await createUser(`alice_${s}`);
    bob = await createUser(`bob_${s}`);
  });

  it('delivers a message sent via chat-1 to a subscriber on chat-2 (and the reverse)', async () => {
    const chatId = await createChatWith(alice.id, [bob.id]);

    const onTwo = wsClient(`${CHAT_2}/graphql`);
    const subTwo = subscribeMessages(onTwo, chatId);
    await subTwo.ready;

    const sent = await gql(CHAT_1 + '/graphql', `mutation($i: SendMessageInput!) { sendMessage(input: $i) { id seq } }`, {
      i: { chatId, senderId: alice.id, content: 'sent through chat-1' },
    });
    expect(sent.errors).toBeUndefined();
    expect(sent.instance).toBe('chat-1');

    const received = await subTwo.nextMessage();
    expect(received).toMatchObject({ id: sent.data.sendMessage.id, seq: 1, content: 'sent through chat-1' });
    await onTwo.dispose();

    const onOne = wsClient(`${CHAT_1}/graphql`);
    const subOne = subscribeMessages(onOne, chatId);
    await subOne.ready;
    const sent2 = await gql(CHAT_2 + '/graphql', `mutation($i: SendMessageInput!) { sendMessage(input: $i) { id seq } }`, {
      i: { chatId, senderId: bob.id, content: 'sent through chat-2' },
    });
    expect(sent2.instance).toBe('chat-2');
    const received2 = await subOne.nextMessage();
    expect(received2).toMatchObject({ id: sent2.data.sendMessage.id, seq: 2 });
    await onOne.dispose();
  });

  it('keeps order when sends are load-balanced across instances through the gateway', async () => {
    const chatId = await createChatWith(alice.id, [bob.id]);
    const ws = wsClient(`${GATEWAY}/chat/graphql`); // browser path: WebSocket through nginx
    const sub = subscribeMessages(ws, chatId);
    await sub.ready;

    const instances = new Set<string | null>();
    const N = 12;
    for (let i = 1; i <= N; i++) {
      const res = await gql(`${GATEWAY}/chat/graphql`, `mutation($i: SendMessageInput!) { sendMessage(input: $i) { seq } }`, {
        i: { chatId, senderId: i % 2 ? alice.id : bob.id, content: `msg ${i}` },
      });
      expect(res.errors).toBeUndefined();
      expect(res.data.sendMessage.seq).toBe(i);
      instances.add(res.instance);
    }
    // nginx round-robins: both instances must have handled sends.
    expect([...instances].sort()).toEqual(['chat-1', 'chat-2']);

    // Live stream through the gateway saw all N in order.
    const deadline = Date.now() + 10_000;
    while (sub.messages.length < N && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(sub.messages.map((m) => m.seq)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    await ws.dispose();

    // History from either instance is identical and ordered.
    const [h1, h2] = await Promise.all(
      [CHAT_1, CHAT_2].map((base) => gql(`${base}/graphql`, `query($c: ID!) { messages(chatId: $c) { seq content } }`, { c: chatId })),
    );
    expect(h1.data.messages).toEqual(h2.data.messages);
    expect(h1.data.messages.map((m: any) => m.seq)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it('serves users from both user-service instances through the gateway', async () => {
    const seen = new Set<string | null>();
    for (let i = 0; i < 6; i++) {
      const res = await gql(`${GATEWAY}/users/graphql`, `query($id: ID!) { user(id: $id) { id } }`, { id: alice.id });
      expect(res.data.user.id).toBe(alice.id);
      seen.add(res.instance);
    }
    expect([...seen].sort()).toEqual(['user-1', 'user-2']);
  });
});
