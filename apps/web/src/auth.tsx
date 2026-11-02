import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@stillwater/shared';
import { api, ApiFailure } from './api';

/** The signed-in user, or null. Undefined while loading. */
export function useMe(): { user: User | null | undefined; refresh: () => Promise<void> } {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (err) {
        if (err instanceof ApiFailure && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
  return {
    user: q.isPending ? undefined : (q.data ?? null),
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  };
}

export function useCurrentUser(): User {
  const { user } = useMe();
  if (!user) throw new Error('useCurrentUser outside a signed-in route');
  return user;
}
