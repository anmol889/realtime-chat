import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLError } from 'graphql';

/**
 * Minimal GraphQL client for user-service, used only when a user joins a chat (decision D6):
 * the hot path (sendMessage / messages / subscription) never calls another service.
 *
 * Fails closed: if user-service cannot be reached, the join is rejected with UPSTREAM_UNAVAILABLE
 * rather than silently admitting an unverified user.
 */
@Injectable()
export class UserClient {
  private readonly logger = new Logger(UserClient.name);
  private readonly url: string;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>('USER_SERVICE_URL');
    this.enabled = config.get<boolean>('VERIFY_USERS') !== false;
  }

  async userExists(userId: string, timeoutMs = 2000): Promise<boolean> {
    if (!this.enabled) return true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'query($id: ID!) { user(id: $id) { id } }', variables: { id: userId } }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`user-service responded ${res.status}`);
      const body = (await res.json()) as { data?: { user: { id: string } | null } };
      return Boolean(body.data?.user?.id);
    } catch (err) {
      this.logger.warn(`user-service unreachable: ${(err as Error).message}`);
      throw new GraphQLError('user-service is unavailable, try again', {
        extensions: { code: 'UPSTREAM_UNAVAILABLE' },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
