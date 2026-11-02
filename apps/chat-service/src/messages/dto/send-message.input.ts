import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID, Length, Matches } from 'class-validator';

@InputType()
export class SendMessageInput {
  @Field(() => ID)
  @IsUUID()
  chatId: string;

  @Field(() => ID)
  @IsUUID()
  senderId: string;

  @Field()
  @Length(1, 4000)
  content: string;

  @Field({ nullable: true })
  @IsOptional()
  @Length(1, 64)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  clientMessageId?: string;
}
