import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { join } from 'path';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { formatGraphQLError } from './common/graphql-errors';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Code-first: the schema is generated from the decorated classes and written to schema.gql
        // (committed, so the frontend can be typed against it without booting the service).
        autoSchemaFile: join(process.cwd(), 'schema.gql'),
        sortSchema: true,
        path: '/graphql',
        playground: false,
        plugins: [ApolloServerPluginLandingPageLocalDefault({ embed: true })],
        formatError: formatGraphQLError,
        context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
        // Surface which instance answered: useful when demoing the load balancer.
        buildSchemaOptions: {},
        introspection: true,
        // `csrfPrevention` stays enabled (default); the frontend sends application/json.
        includeStacktraceInErrorResponses: config.get('NODE_ENV') !== 'production',
      }),
    }),
    PrismaModule,
    HealthModule,
    UsersModule,
  ],
})
export class AppModule {}
