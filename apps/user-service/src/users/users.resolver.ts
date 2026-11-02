import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ParseUUIDPipe } from '@nestjs/common';
import { CreateUserInput } from './dto/create-user.input';
import { User } from './models/user.model';
import { UsersService } from './users.service';

@Resolver(() => User)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => User, { nullable: true, description: 'Look up a user by id (null if absent).' })
  async user(@Args('id', { type: () => ID }, ParseUUIDPipe) id: string): Promise<User | null> {
    return this.usersService.findById(id).catch(() => null);
  }

  @Query(() => User, { nullable: true })
  async userByUsername(@Args('username') username: string): Promise<User | null> {
    return this.usersService.findByUsername(username);
  }

  @Query(() => [User], { description: 'Batch lookup; missing ids are simply omitted.' })
  async users(@Args('ids', { type: () => [ID] }) ids: string[]): Promise<User[]> {
    return this.usersService.findByIds(ids);
  }

  @Mutation(() => User)
  async createUser(@Args('input') input: CreateUserInput): Promise<User> {
    return this.usersService.create(input);
  }
}
