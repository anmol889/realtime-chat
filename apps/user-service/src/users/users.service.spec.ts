import { Prisma } from '../../prisma/generated/client';
import { UsersService } from './users.service';
import { ConflictError, NotFoundError } from '../common/graphql-errors';

/** Unit tests: PrismaService is replaced by a minimal in-memory fake. */
describe('UsersService', () => {
  const prisma = {
    user: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  };
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UsersService(prisma as any);
  });

  it('normalises usernames to lower case and defaults displayName', async () => {
    prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'u1', ...data, createdAt: new Date() }));
    const user = await service.create({ username: '  Alice_1 ' });
    expect(user.username).toBe('alice_1');
    expect(user.displayName).toBe('Alice_1');
  });

  it('maps a unique-constraint violation to ConflictError', async () => {
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.create({ username: 'alice' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError for unknown ids', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findById('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('dedupes ids in batch lookup and short-circuits on empty input', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.findByIds(['a', 'a', 'b']);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } } });
    expect(await service.findByIds([])).toEqual([]);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });
});
