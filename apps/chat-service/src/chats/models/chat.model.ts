import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Chat {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => [ID], { description: 'User ids of members (resolve names via user-service).' })
  memberIds: string[];

  @Field(() => Int, { description: 'seq of the latest message; 0 for an empty chat.' })
  lastSeq: number;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;
}
