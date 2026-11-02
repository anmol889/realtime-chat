import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictError, NotFoundError } from '../common/graphql-errors';
import { CreateUserInput } from './dto/create-user.input';
import { User } from './models/user.model';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Usernames are normalised to lower case so "Alice" and "alice" are the same account. */
  static normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  async create(input: CreateUserInput): Promise<User> {
    const username = UsersService.normalizeUsername(input.username);
    const displayName = input.displayName?.trim() || input.username.trim();
    try {
      return await this.prisma.user.create({ data: { username, displayName } });
    } catch (err) {
      // Rely on the DB unique index instead of a check-then-insert: two instances creating the
      // same username concurrently cannot both succeed.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError(`username "${username}" is already taken`);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError(`user ${id} not found`);
    return user;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { username: UsersService.normalizeUsername(username) },
    });
  }

  /** Batch lookup for the frontend (resolve many senderIds in one round trip). Order not guaranteed. */
  async findByIds(ids: string[]): Promise<User[]> {
    const unique = [...new Set(ids)].slice(0, 200);
    if (unique.length === 0) return [];
    return this.prisma.user.findMany({ where: { id: { in: unique } } });
  }
}
