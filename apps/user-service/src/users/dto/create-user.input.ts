import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, Length, Matches } from 'class-validator';

@InputType()
export class CreateUserInput {
  @Field()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username may contain letters, digits, _ . -' })
  username: string;

  @Field({ nullable: true })
  @IsOptional()
  @Length(1, 64)
  displayName?: string;
}
