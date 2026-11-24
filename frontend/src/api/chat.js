import { api } from './client';

/** Opens (or reuses) a conversation and returns the room. */
export const openRoom = (payload) => api.post('/chat/rooms', payload).then((r) => r.data);

/** Chat page path for the current user's dashboard. */
export function chatPathFor(user, roomId) {
  const r = user?.roles || [];
  const base = r.some((x) => ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'].includes(x))
    ? '/admin/chat'
    : r.includes('DOCTOR')
      ? '/doctor/chat'
      : r.some((x) => /^(LAB|RADIOLOGY|PHARMACY)_/.test(x))
        ? '/provider/chat'
        : '/patient/chat';
  return roomId ? `${base}?room=${roomId}` : base;
}
