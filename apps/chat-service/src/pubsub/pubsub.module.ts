import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis from 'ioredis';

export const PUB_SUB = Symbol('PUB_SUB');

/**
 * Cross-instance fan-out (decision D1 in docs/IMPLEMENTATION_PLAN.md).
 *
 * Each chat-service instance publishes every persisted message to Redis and subscribes to the
 * chats its own WebSocket clients are watching. A message sent through instance 1 therefore
 * reaches a subscriber connected to instance 2 without sticky sessions.
 *
 * Redis Pub/Sub is at-most-once in transit: that is acceptable because messages are persisted
 * first and clients catch up by `seq` on (re)connect (decision D3).
 */
/** Quit both Redis connections on shutdown so instances (and test processes) exit cleanly. */
@Injectable()
class PubSubLifecycle implements OnModuleDestroy {
  constructor(@Inject(PUB_SUB) private readonly pubSub: RedisPubSub) {}
  async onModuleDestroy(): Promise<void> {
    await this.pubSub.close();
  }
}

@Global()
@Module({
  providers: [
    PubSubLifecycle,
    {
      provide: PUB_SUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('REDIS_URL');
        const instanceId = config.getOrThrow<string>('INSTANCE_ID');
        const logger = new Logger('PubSub');
        const options = { maxRetriesPerRequest: null as null, enableReadyCheck: true, lazyConnect: false };
        const publisher = new Redis(url, options);
        const subscriber = new Redis(url, options);
        for (const [name, client] of [
          ['publisher', publisher],
          ['subscriber', subscriber],
        ] as const) {
          client.on('error', (err) => logger.error(`[${instanceId}] redis ${name} error: ${err.message}`));
          client.on('ready', () => logger.log(`[${instanceId}] redis ${name} ready`));
        }
        return new RedisPubSub({
          publisher,
          subscriber,
          // Payloads travel as JSON; restore Date instances so the DateTime scalar serialises them.
          reviver: (key: string, value: unknown) =>
            key === 'createdAt' && typeof value === 'string' ? new Date(value) : value,
        });
      },
    },
  ],
  exports: [PUB_SUB],
})
export class PubSubModule {}
