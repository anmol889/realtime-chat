import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { join } from 'path';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { PubSubModule } from './pubsub/pubsub.module';
import { ChatsModule } from './chats/chats.module';
import { MessagesModule } from './messages/messages.module';
import { formatGraphQLError } from './common/graphql-errors';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        autoSchemaFile: join(process.cwd(), 'schema.gql'),
        sortSchema: true,
        path: '/graphql',
        playground: false,
        plugins: [ApolloServerPluginLandingPageLocalDefault({ embed: true })],
        formatError: formatGraphQLError,
        introspection: true,
        includeStacktraceInErrorResponses: config.get('NODE_ENV') !== 'production',
        context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
        // graphql-ws is the maintained WebSocket protocol (the legacy subscriptions-transport-ws
        // is deliberately not enabled). Same path as HTTP so nginx needs one location block.
        subscriptions: {
          'graphql-ws': { path: '/graphql' },
        },
      }),
    }),
    PrismaModule,
    PubSubModule,
    HealthModule,
    ChatsModule,
    MessagesModule,
  ],
})
export class AppModule {}
