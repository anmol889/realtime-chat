import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field()
  username: string;

  @Field()
  displayName: string;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;
}
