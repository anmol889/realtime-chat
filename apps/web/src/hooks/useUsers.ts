import { useQuery } from '@apollo/client';
import { useMemo } from 'react';
import { USERS_BY_IDS, type User } from '../graphql/operations';

/** Resolve display names for a set of user ids via user-service (one batched query, cached by Apollo). */
export function useUsers(ids: readonly string[]): Map<string, User> {
  const sorted = useMemo(() => [...new Set(ids)].sort(), [ids]);
  const { data } = useQuery<{ users: User[] }>(USERS_BY_IDS, {
    variables: { ids: sorted },
    context: { service: 'users' },
    skip: sorted.length === 0,
  });
  return useMemo(() => new Map((data?.users ?? []).map((u) => [u.id, u])), [data]);
}
