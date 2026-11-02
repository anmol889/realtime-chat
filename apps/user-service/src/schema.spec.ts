import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import { printSchema } from 'graphql';
import { UsersResolver } from './users/users.resolver';

/** Builds the code-first schema without booting the app: catches decorator/type mistakes early. */
describe('GraphQL schema', () => {
  it('builds and exposes the expected operations', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [GraphQLSchemaBuilderModule] }).compile();
    const factory = moduleRef.get(GraphQLSchemaFactory);
    const sdl = printSchema(await factory.create([UsersResolver]));
    expect(sdl).toContain('createUser(input: CreateUserInput!): User!');
    expect(sdl).toContain('users(ids: [ID!]!): [User!]!');
  });
});
