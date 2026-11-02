import { Module } from '@nestjs/common';
import { UserClient } from '../common/user-client';
import { ChatsResolver } from './chats.resolver';
import { ChatsService } from './chats.service';

@Module({ providers: [ChatsService, ChatsResolver, UserClient], exports: [ChatsService] })
export class ChatsModule {}
