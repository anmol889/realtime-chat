import { Prisma } from '../../prisma/generated/client';
import { MessagesService, clampLimit, messageTopic, DEFAULT_PAGE, MAX_PAGE } from './messages.service';
import { ForbiddenError, NotFoundError } from '../common/graphql-errors';

/** Unit tests with a fake Prisma + fake PubSub; the DB-level ordering guarantee is covered in integration tests. */
describe('clampLimit', () => {
  it('defaults and clamps', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE);
    expect(clampLimit(0)).toBe(DEFAULT_PAGE);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(10_000)).toBe(MAX_PAGE);
    expect(clampLimit(7.9)).toBe(7);
  });
});

describe('MessagesService', () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const senderId = '22222222-2222-4222-8222-222222222222';
  const tx = {
    chatMember: { findUnique: jest.fn() },
    chat: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    message: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    message: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const pubSub = { publish: jest.fn(), asyncIterator: jest.fn() };
  const config = { getOrThrow: () => 'chat-test' };
  let service: MessagesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MessagesService(prisma as any, pubSub as any, config as any);
  });

  it('persists with the seq returned by the counter update, then publishes', async () => {
    tx.chatMember.findUnique.mockResolvedValue({ chatId, userId: senderId });
    tx.$queryRaw.mockResolvedValue([{ last_seq: 42 }]);
    tx.message.create.mockImplementation(async ({ data }: any) => ({ id: 'm1', ...data, createdAt: new Date() }));

    const msg = await service.send({ chatId, senderId, content: '  hi  ' });

    expect(msg.seq).toBe(42);
    expect(msg.content).toBe('hi');
    expect(tx.message.create).toHaveBeenCalledWith({
      data: { chatId, senderId, seq: 42, content: 'hi', clientMessageId: undefined },
    });
    expect(pubSub.publish).toHaveBeenCalledWith(messageTopic(chatId), { messageAdded: msg });
    // publish must happen after the transaction resolved (persist-then-publish)
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(pubSub.publish.mock.invocationCallOrder[0]);
  });

  it('rejects non-members without touching the counter or publishing', async () => {
    tx.chatMember.findUnique.mockResolvedValue(null);
    tx.chat.findUnique.mockResolvedValue({ id: chatId });
    await expect(service.send({ chatId, senderId, content: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(pubSub.publish).not.toHaveBeenCalled();
  });

  it('reports a missing chat as NOT_FOUND', async () => {
    tx.chatMember.findUnique.mockResolvedValue(null);
    tx.chat.findUnique.mockResolvedValue(null);
    await expect(service.send({ chatId, senderId, content: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the original message on an idempotent retry and does not re-publish', async () => {
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['chat_id', 'sender_id', 'client_message_id'] },
      }),
    );
    const existing = { id: 'm0', chatId, senderId, seq: 3, content: 'x', clientMessageId: 'c1', createdAt: new Date() };
    prisma.message.findUnique.mockResolvedValue(existing);

    const msg = await service.send({ chatId, senderId, content: 'x', clientMessageId: 'c1' });
    expect(msg).toBe(existing);
    expect(pubSub.publish).not.toHaveBeenCalled();
  });

  it('pages forward ascending and backward by reversing a descending query', async () => {
    prisma.message.findMany.mockResolvedValue([{ seq: 9 }, { seq: 8 }]);
    const older = await service.list(chatId, 0, 10, 2);
    expect(older.map((m) => m.seq)).toEqual([8, 9]);
    expect(prisma.message.findMany).toHaveBeenLastCalledWith({
      where: { chatId, seq: { lt: 10, gt: 0 } },
      orderBy: { seq: 'desc' },
      take: 2,
    });

    prisma.message.findMany.mockResolvedValue([]);
    await service.list(chatId, 5);
    expect(prisma.message.findMany).toHaveBeenLastCalledWith({
      where: { chatId, seq: { gt: 5 } },
      orderBy: { seq: 'asc' },
      take: DEFAULT_PAGE,
    });
  });
});
