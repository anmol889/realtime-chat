import { GraphQLError, GraphQLFormattedError } from 'graphql';

/**
 * Domain errors carry a stable `extensions.code` the frontend can branch on.
 * Throwing GraphQLError subclasses (instead of Nest HttpException) keeps the wire format clean:
 * { message, extensions: { code } } with no leaked stack traces or HTTP status wrappers.
 */
export class NotFoundError extends GraphQLError {
  constructor(message: string) {
    super(message, { extensions: { code: 'NOT_FOUND' } });
  }
}

export class ConflictError extends GraphQLError {
  constructor(message: string) {
    super(message, { extensions: { code: 'CONFLICT' } });
  }
}

export class ForbiddenError extends GraphQLError {
  constructor(message: string) {
    super(message, { extensions: { code: 'FORBIDDEN' } });
  }
}

export class BadUserInputError extends GraphQLError {
  constructor(message: string) {
    super(message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

/** Strip the `originalError` blob Nest attaches for non-GraphQLError exceptions. */
export function formatGraphQLError(formatted: GraphQLFormattedError): GraphQLFormattedError {
  const { originalError, stacktrace, ...rest } = (formatted.extensions ?? {}) as Record<string, unknown>;
  void originalError;
  void stacktrace;
  return { ...formatted, extensions: rest };
}
