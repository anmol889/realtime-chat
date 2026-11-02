import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { InstanceIdInterceptor } from './common/instance-id.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');
  const instanceId = config.getOrThrow<string>('INSTANCE_ID');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new InstanceIdInterceptor(instanceId));
  app.enableShutdownHooks();

  await app.listen(port);
  Logger.log(`[${instanceId}] user-service listening on :${port} (GraphQL at /graphql)`, 'Bootstrap');
}

void bootstrap();
