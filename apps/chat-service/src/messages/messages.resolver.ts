import { Args, ID, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { assertUuid } from '../common/uuid';
import { SendMessageInput } from './dto/send-message.input';
import { Message } from './models/message.model';
import { MessagesService } from './messages.service';

@Resolver(() => Message)
export class MessagesResolver {
  constructor(private readonly messagesService: MessagesService) {}

  @Query(() => [Message], {
    description: 'Ordered history. Use afterSeq as a catch-up cursor, beforeSeq to load older messages.',
  })
  messages(
    @Args('chatId', { type: () => ID }) chatId: string,
    @Args('afterSeq', { type: () => Int, nullable: true, defaultValue: 0 }) afterSeq: number,
    @Args('beforeSeq', { type: () => Int, nullable: true }) beforeSeq?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 }) limit?: number,
  ): Promise<Message[]> {
    return this.messagesService.list(assertUuid(chatId, 'chatId'), afterSeq ?? 0, beforeSeq, limit);
  }

  @Mutation(() => Message)
  sendMessage(@Args('input') input: SendMessageInput): Promise<Message> {
    return this.messagesService.send(input);
  }

  @Subscription(() => Message, {
    name: 'messageAdded',
    description: 'Live stream of new messages in a chat, delivered from whichever instance persisted them.',
  })
  messageAdded(@Args('chatId', { type: () => ID }) chatId: string) {
    return this.messagesService.subscribe(assertUuid(chatId, 'chatId'));
  }
}
