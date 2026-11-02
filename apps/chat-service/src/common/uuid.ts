import { BadUserInputError } from './graphql-errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate ids before they reach Postgres (an invalid uuid literal would be a 500 otherwise). */
export function assertUuid(value: string, field: string): string {
  if (!UUID_RE.test(value)) throw new BadUserInputError(`${field} must be a UUID`);
  return value;
}
