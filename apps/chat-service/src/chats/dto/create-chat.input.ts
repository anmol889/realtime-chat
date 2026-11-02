import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Length } from 'class-validator';

@InputType()
export class CreateChatInput {
  @Field()
  @Length(1, 64)
  name: string;

  @Field(() => ID, { description: 'The creator joins the chat automatically.' })
  @IsUUID()
  creatorId: string;
}
