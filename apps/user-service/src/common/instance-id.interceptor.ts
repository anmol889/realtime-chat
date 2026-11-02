import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';

/**
 * Adds an `x-instance` response header on every HTTP and GraphQL response so a reviewer can see
 * round-robin across instances with plain curl / browser dev tools.
 */
@Injectable()
export class InstanceIdInterceptor implements NestInterceptor {
  constructor(private readonly instanceId: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res =
      context.getType<'http' | 'graphql'>() === 'graphql'
        ? GqlExecutionContext.create(context).getContext()?.res
        : context.switchToHttp().getResponse();
    if (res && typeof res.setHeader === 'function' && !res.headersSent) {
      res.setHeader('x-instance', this.instanceId);
    }
    return next.handle();
  }
}
