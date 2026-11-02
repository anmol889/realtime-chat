import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Message {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  chatId: string;

  @Field(() => ID)
  senderId: string;

  @Field(() => Int, { description: 'Gap-free, strictly increasing per chat. Sort and dedupe by this.' })
  seq: number;

  @Field()
  content: string;

  @Field(() => String, { nullable: true, description: 'Echo of the client-supplied id, for optimistic UI reconciliation.' })
  clientMessageId?: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;
}
