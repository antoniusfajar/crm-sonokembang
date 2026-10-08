import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; name: string; email: string; role: 'sales' | 'marketing' | 'spv' | 'admin'; roleLabel: string; scope: 'own' | 'all'; mustChangePassword: boolean };
  menus: { group: string; items: { key: string; label: string; phase: number }[] }[];
  badges: { inbox: number; ai: number; tugas: number; notif: number };
  business: { name: string; logo: string | null };
  waMode: 'simulator' | 'meta';
  today: string;
}

const MeCtx = createContext<Me | null>(null);

export function useMeQuery() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    refetchInterval: 60_000,
  });
}

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  useEffect(() => {
    const h = () => qc.setQueryData(['me'], null);
    window.addEventListener('crm:unauthorized', h);
    return () => window.removeEventListener('crm:unauthorized', h);
  }, [qc]);
  return <MeCtx.Provider value={me}>{children}</MeCtx.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeCtx);
  if (!me) throw new Error('useMe di luar MeProvider');
  return me;
}

export const can = (me: Me, key: string) => me.menus.some((g) => g.items.some((i) => i.key === key));
export const isRole = (me: Me, ...roles: Me['user']['role'][]) => roles.includes(me.user.role);
