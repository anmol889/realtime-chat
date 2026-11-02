import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../prisma/generated/client';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { PrismaService } from '../prisma/prisma.service';
import { PUB_SUB } from '../pubsub/pubsub.module';
import { ForbiddenError, NotFoundError } from '../common/graphql-errors';
import { SendMessageInput } from './dto/send-message.input';
import { Message } from './models/message.model';

export const MAX_PAGE = 200;
export const DEFAULT_PAGE = 50;

export function messageTopic(chatId: string): string {
  return `chat.${chatId}.messages`;
}

/** Clamp a client-supplied page size into [1, MAX_PAGE]. Exported so it can be unit-tested. */
export function clampLimit(limit?: number | null): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_PAGE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE);
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private readonly instanceId: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUB_SUB) private readonly pubSub: RedisPubSub,
    config: ConfigService,
  ) {
    this.instanceId = config.getOrThrow<string>('INSTANCE_ID');
  }

  /**
   * Persist-then-publish (decisions D2 + D3).
   *
   * 1. Inside one transaction: check membership, bump `chats.last_seq` (this takes a row lock,
   *    serialising all concurrent writers to the same chat across every instance), insert the
   *    message with that seq.
   * 2. After commit: publish to Redis so every instance fans the message out to its subscribers.
   *
   * If the client retries with the same clientMessageId, the unique index rejects the duplicate
   * insert, the transaction rolls back (so no seq is burned) and the original row is returned.
   */
  async send(input: SendMessageInput): Promise<Message> {
    const { chatId, senderId, clientMessageId } = input;
    const content = input.content.trim();
    try {
      const message = await this.prisma.$transaction(async (tx) => {
        const member = await tx.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: senderId } } });
        if (!member) {
          const chat = await tx.chat.findUnique({ where: { id: chatId }, select: { id: true } });
          if (!chat) throw new NotFoundError(`chat ${chatId} not found`);
          throw new ForbiddenError(`user ${senderId} is not a member of chat ${chatId}`);
        }
        const rows = await tx.$queryRaw<{ last_seq: number }[]>`
          UPDATE chats SET last_seq = last_seq + 1 WHERE id = ${chatId}::uuid RETURNING last_seq`;
        const seq = rows[0].last_seq;
        return tx.message.create({ data: { chatId, senderId, seq, content, clientMessageId } });
      });
      await this.pubSub.publish(messageTopic(chatId), { messageAdded: message });
      this.logger.log(`[${this.instanceId}] persisted+published chat=${chatId} seq=${message.seq}`);
      return message;
    } catch (err) {
      if (
        clientMessageId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        String((err.meta as { target?: unknown })?.target ?? '').includes('client_message_id')
      ) {
        const existing = await this.prisma.message.findUnique({
          where: { chatId_senderId_clientMessageId: { chatId, senderId, clientMessageId } },
        });
        if (existing) {
          this.logger.log(`[${this.instanceId}] idempotent replay chat=${chatId} seq=${existing.seq}`);
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * History page. `afterSeq` is the catch-up cursor used by clients after a (re)connect;
   * `beforeSeq` pages backwards for "load older". Results are always ascending by seq.
   */
  async list(chatId: string, afterSeq = 0, beforeSeq?: number | null, limit?: number | null): Promise<Message[]> {
    const take = clampLimit(limit);
    if (beforeSeq != null) {
      const rows = await this.prisma.message.findMany({
        where: { chatId, seq: { lt: beforeSeq, gt: afterSeq } },
        orderBy: { seq: 'desc' },
        take,
      });
      return rows.reverse();
    }
    return this.prisma.message.findMany({
      where: { chatId, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take,
    });
  }

  subscribe(chatId: string): AsyncIterator<{ messageAdded: Message }> {
    this.logger.log(`[${this.instanceId}] subscriber attached chat=${chatId}`);
    return this.pubSub.asyncIterator(messageTopic(chatId));
  }
}
