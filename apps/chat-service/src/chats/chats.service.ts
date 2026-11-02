import { Injectable } from '@nestjs/common';
import { Chat as ChatRow, ChatMember } from '../../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserClient } from '../common/user-client';
import { NotFoundError } from '../common/graphql-errors';
import { Chat } from './models/chat.model';

type ChatWithMembers = ChatRow & { members: Pick<ChatMember, 'userId'>[] };

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserClient,
  ) {}

  static toModel(row: ChatWithMembers): Chat {
    return {
      id: row.id,
      name: row.name,
      lastSeq: row.lastSeq,
      createdAt: row.createdAt,
      memberIds: row.members.map((m) => m.userId),
    };
  }

  async create(name: string, creatorId: string): Promise<Chat> {
    if (!(await this.users.userExists(creatorId))) throw new NotFoundError(`user ${creatorId} not found`);
    const row = await this.prisma.chat.create({
      data: { name: name.trim(), members: { create: { userId: creatorId } } },
      include: { members: { select: { userId: true } } },
    });
    return ChatsService.toModel(row);
  }

  async join(chatId: string, userId: string): Promise<Chat> {
    const exists = await this.prisma.chat.findUnique({ where: { id: chatId }, select: { id: true } });
    if (!exists) throw new NotFoundError(`chat ${chatId} not found`);
    if (!(await this.users.userExists(userId))) throw new NotFoundError(`user ${userId} not found`);
    // Upsert makes joining idempotent (a double-click or a retry is harmless).
    await this.prisma.chatMember.upsert({
      where: { chatId_userId: { chatId, userId } },
      create: { chatId, userId },
      update: {},
    });
    return this.findById(chatId);
  }

  async findById(chatId: string): Promise<Chat> {
    const row = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { members: { select: { userId: true } } },
    });
    if (!row) throw new NotFoundError(`chat ${chatId} not found`);
    return ChatsService.toModel(row);
  }

  async list(): Promise<Chat[]> {
    const rows = await this.prisma.chat.findMany({
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { members: { select: { userId: true } } },
    });
    return rows.map(ChatsService.toModel);
  }

  async isMember(chatId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } } });
    return Boolean(m);
  }
}
