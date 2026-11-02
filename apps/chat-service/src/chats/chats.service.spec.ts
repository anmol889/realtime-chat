import { ChatsService } from './chats.service';
import { NotFoundError } from '../common/graphql-errors';

describe('ChatsService', () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const prisma = {
    chat: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    chatMember: { upsert: jest.fn(), findUnique: jest.fn() },
  };
  const users = { userExists: jest.fn() };
  let service: ChatsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatsService(prisma as any, users as any);
  });

  it('refuses to admit a user that user-service does not know', async () => {
    prisma.chat.findUnique.mockResolvedValue({ id: chatId });
    users.userExists.mockResolvedValue(false);
    await expect(service.join(chatId, userId)).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.chatMember.upsert).not.toHaveBeenCalled();
  });

  it('joins idempotently via upsert', async () => {
    prisma.chat.findUnique
      .mockResolvedValueOnce({ id: chatId })
      .mockResolvedValueOnce({ id: chatId, name: 'g', lastSeq: 0, createdAt: new Date(), members: [{ userId }] });
    users.userExists.mockResolvedValue(true);
    const chat = await service.join(chatId, userId);
    expect(prisma.chatMember.upsert).toHaveBeenCalledWith({
      where: { chatId_userId: { chatId, userId } },
      create: { chatId, userId },
      update: {},
    });
    expect(chat.memberIds).toEqual([userId]);
  });

  it('maps rows to the GraphQL model', () => {
    const now = new Date();
    expect(
      ChatsService.toModel({ id: chatId, name: 'n', lastSeq: 3, createdAt: now, members: [{ userId }] }),
    ).toEqual({ id: chatId, name: 'n', lastSeq: 3, createdAt: now, memberIds: [userId] });
  });
});
