import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import { printSchema } from 'graphql';
import { ChatsResolver } from './chats/chats.resolver';
import { MessagesResolver } from './messages/messages.resolver';

/** Builds the code-first schema without booting the app: catches decorator/type mistakes early. */
describe('GraphQL schema', () => {
  it('builds and exposes the expected operations', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [GraphQLSchemaBuilderModule] }).compile();
    const factory = moduleRef.get(GraphQLSchemaFactory);
    const schema = await factory.create([ChatsResolver, MessagesResolver]);
    const sdl = printSchema(schema);
    expect(sdl).toContain('sendMessage(input: SendMessageInput!): Message!');
    expect(sdl).toContain('messageAdded(chatId: ID!): Message!');
    expect(sdl).toMatch(/messages\(chatId: ID!, afterSeq: Int = 0, beforeSeq: Int, limit: Int = 50\): \[Message!\]!/);
    expect(sdl).toContain('clientMessageId: String');
  });
});
