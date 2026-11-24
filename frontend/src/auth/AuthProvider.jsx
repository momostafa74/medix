import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useSnackbar } from 'notistack';
import { api, getAccessToken, refreshAccessToken, setAccessToken, setOnSessionExpired } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);

  const connectSocket = useCallback(() => {
    socketRef.current?.disconnect();
    const token = getAccessToken();
    if (!token) return;
    const base = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const s = io(`${base}/realtime`, { auth: { token }, transports: ['websocket', 'polling'], reconnectionAttempts: 5 });
    s.on('chat:message', () => qc.invalidateQueries({ queryKey: ['chat'] }));
    s.on('lab:order', () => qc.invalidateQueries({ queryKey: ['lab-orders'] }));
    s.on('radiology:order', () => qc.invalidateQueries({ queryKey: ['radiology-orders'] }));
    s.on('payment:update', () => qc.invalidateQueries({ queryKey: ['payments'] }));
    s.on('notification', (n) => {
      if (n.category === 'CHAT') return; // chat has its own live UI
      enqueueSnackbar(n.title, { variant: 'info' });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      if (n.category === 'APPOINTMENTS') qc.invalidateQueries({ queryKey: ['appointments'] });
      if (n.category === 'LAB_RESULTS') qc.invalidateQueries({ queryKey: ['lab-results-history'] });
      if (n.category === 'RADIOLOGY') qc.invalidateQueries({ queryKey: ['radiology-history'] });
    });
    socketRef.current = s;
    setSocket(s);
  }, [enqueueSnackbar, qc]);

  const loadMe = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    setUser(data);
    return data;
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    socketRef.current?.disconnect();
    setSocket(null);
    qc.clear();
  }, [qc]);

  // Restore session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    setOnSessionExpired(() => {
      clear();
      enqueueSnackbar('انتهت الجلسة، من فضلك سجّل الدخول مرة أخرى', { variant: 'warning' });
    });
    refreshAccessToken()
      .then(loadMe)
      .then(connectSocket)
      .catch(() => setAccessToken(null))
      .finally(() => setReady(true));
    // A 402 from any request means the provider subscription just lapsed: reload the principal so the renewal gate shows.
    const onLapse = () => api.get('/auth/me').then((r) => setUser(r.data)).catch(() => {});
    window.addEventListener('medix:subscription', onLapse);
    return () => {
      socketRef.current?.disconnect();
      window.removeEventListener('medix:subscription', onLapse);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyAuth = useCallback(
    (data) => {
      setAccessToken(data.accessToken);
      setUser(data.user);
      connectSocket();
      return data.user;
    },
    [connectSocket],
  );

  const value = useMemo(
    () => ({
      user,
      ready,
      socket,
      isAuthenticated: !!user,
      /** Returns the user, or `{ twoFactorRequired, challengeToken }` when a second step is needed. */
      login: async (identifier, password) => {
        const { data } = await api.post('/auth/login', { identifier, password });
        return data.twoFactorRequired ? data : applyAuth(data);
      },
      verifyTwoFactor: async (challengeToken, code) => applyAuth((await api.post('/auth/2fa/verify', { challengeToken, code })).data),
      register: async (payload) => applyAuth((await api.post('/auth/register', payload)).data),
      registerDoctor: async (payload) => applyAuth((await api.post('/auth/register/doctor', payload)).data),
      applyAuth,
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } finally {
          clear();
        }
      },
      reload: loadMe,
      can: (perm) => !!user?.permissions?.includes(perm),
      hasRole: (...roles) => !!user?.roles?.some((r) => roles.includes(r)),
    }),
    [user, ready, socket, applyAuth, clear, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Subscribe to a realtime event for the lifetime of the component. */
export function useRealtime(event, handler) {
  const { socket } = useAuth();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const fn = (d) => ref.current(d);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [socket, event]);
}

/** Where each kind of account lands after login. */
export function homeFor(user) {
  if (!user) return '/';
  const r = user.roles || [];
  if (r.some((x) => ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'ACCOUNTANT'].includes(x))) return '/admin';
  if (r.includes('DOCTOR')) return '/doctor';
  if (r.some((x) => x.startsWith('LAB_'))) return '/provider/lab';
  if (r.some((x) => x.startsWith('RADIOLOGY_'))) return '/provider/radiology';
  if (r.some((x) => x.startsWith('PHARMACY_'))) return '/provider/pharmacy';
  return '/patient';
}
