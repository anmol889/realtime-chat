import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { assertUuid } from '../common/uuid';
import { CreateChatInput } from './dto/create-chat.input';
import { Chat } from './models/chat.model';
import { ChatsService } from './chats.service';

@Resolver(() => Chat)
export class ChatsResolver {
  constructor(private readonly chatsService: ChatsService) {}

  @Query(() => [Chat], { description: 'All chats (demo scope: no pagination, capped at 200).' })
  chats(): Promise<Chat[]> {
    return this.chatsService.list();
  }

  @Query(() => Chat, { nullable: true })
  chat(@Args('id', { type: () => ID }) id: string): Promise<Chat | null> {
    return this.chatsService.findById(assertUuid(id, 'id')).catch(() => null);
  }

  @Mutation(() => Chat)
  createChat(@Args('input') input: CreateChatInput): Promise<Chat> {
    return this.chatsService.create(input.name, input.creatorId);
  }

  @Mutation(() => Chat)
  joinChat(
    @Args('chatId', { type: () => ID }) chatId: string,
    @Args('userId', { type: () => ID }) userId: string,
  ): Promise<Chat> {
    return this.chatsService.join(assertUuid(chatId, 'chatId'), assertUuid(userId, 'userId'));
  }
}
