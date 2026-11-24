import { useQuery } from '@tanstack/react-query';
import { api } from './client';

const get = (url) => api.get(url).then((r) => r.data);

export const useSpecialties = () => useQuery({ queryKey: ['specialties'], queryFn: () => get('/specialties'), staleTime: 10 * 60_000 });
export const useLocationsTree = () => useQuery({ queryKey: ['locations', 'tree'], queryFn: () => get('/locations/tree'), staleTime: 60 * 60_000 });
export const usePublicSettings = () => useQuery({ queryKey: ['settings', 'public'], queryFn: () => get('/settings/public'), staleTime: 10 * 60_000 });
export const useUnreadCount = (enabled) =>
  useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => get('/notifications/unread-count'), enabled, refetchInterval: 60_000 });
export { get };
