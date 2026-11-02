import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import request from 'supertest';

/**
 * Integration test: real Postgres (Testcontainers), real migrations, real GraphQL over HTTP.
 * Proves the unique-username rule is enforced by the DB, not just by application logic.
 */
describe('user-service (integration)', () => {
  let pg: StartedPostgreSqlContainer;
  let app: INestApplication;

  const gql = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/graphql').send({ query, variables });

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.DATABASE_URL = pg.getConnectionUri();
    process.env.PORT = '0';
    process.env.INSTANCE_ID = 'user-int';
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });

    // Imported lazily: ConfigModule validates process.env when app.module is first loaded.
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('creates a user, then finds it by id, username and batch', async () => {
    const create = await gql(
      `mutation($input: CreateUserInput!) { createUser(input: $input) { id username displayName } }`,
      { input: { username: 'Alice', displayName: 'Alice A' } },
    );
    expect(create.body.errors).toBeUndefined();
    const { id, username } = create.body.data.createUser;
    expect(username).toBe('alice');

    const byId = await gql(`query($id: ID!) { user(id: $id) { id } }`, { id });
    expect(byId.body.data.user.id).toBe(id);

    const byName = await gql(`query { userByUsername(username: "ALICE") { id } }`);
    expect(byName.body.data.userByUsername.id).toBe(id);

    const batch = await gql(`query($ids: [ID!]!) { users(ids: $ids) { id } }`, {
      ids: [id, '00000000-0000-0000-0000-000000000000'],
    });
    expect(batch.body.data.users).toHaveLength(1);
  });

  it('rejects a duplicate username with code CONFLICT', async () => {
    const res = await gql(`mutation { createUser(input: { username: "alice" }) { id } }`);
    expect(res.body.data).toBeNull();
    expect(res.body.errors[0].extensions.code).toBe('CONFLICT');
  });

  it('rejects invalid input with a validation error', async () => {
    const res = await gql(`mutation { createUser(input: { username: "a" }) { id } }`);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.data).toBeNull();
  });

  it('exposes /health', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
