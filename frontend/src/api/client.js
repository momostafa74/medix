import axios from 'axios';
import { t } from '../i18n';

const BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

/**
 * Access token lives ONLY in memory (never localStorage) so XSS cannot read a
 * persisted token. The refresh token is an httpOnly cookie handled by the browser.
 */
let accessToken = null;
let onExpired = () => {};
export const setAccessToken = (t) => (accessToken = t);
export const getAccessToken = () => accessToken;
export const setOnSessionExpired = (fn) => (onExpired = fn);

export const api = axios.create({ baseURL: BASE, withCredentials: true, timeout: 30000 });

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

let refreshing = null;
/** Single-flight refresh: concurrent 401s wait for one refresh call. */
export function refreshAccessToken() {
  if (!refreshing) {
    refreshing = axios
      .post(`${BASE}/auth/refresh`, {}, { withCredentials: true })
      .then((r) => {
        setAccessToken(r.data.accessToken);
        return r.data.accessToken;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    // Access rules changed server-side (subscription lapsed / staff must enrol in 2FA): reload the principal so the right gate shows.
    const code = error.response?.data?.error;
    if ((status === 402 && code === 'SUBSCRIPTION_REQUIRED') || (status === 403 && code === 'TWO_FACTOR_SETUP_REQUIRED')) window.dispatchEvent(new Event('medix:subscription'));
    const isAuthCall = original?.url?.startsWith('/auth/');
    if (status === 401 && !original._retry && !isAuthCall && accessToken) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        setAccessToken(null);
        onExpired();
      }
    }
    return Promise.reject(error);
  },
);

/** Friendly Arabic message for any API error (the backend already returns Arabic messages). */
export function errorMessage(err) {
  if (!err) return t('error.generic');
  if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') return t('error.network');
  const data = err.response?.data;
  if (data?.details?.length && data.error === 'VALIDATION_ERROR') return data.details.join('، ');
  return data?.message || t('error.generic');
}

export const errorCode = (err) => err?.response?.data?.error;

/** Build a query string from an object, skipping empty values. */
export const qs = (obj = {}) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Download a protected file/CSV with the bearer token and save it. */
export async function downloadFile(url, filename) {
  const res = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

export async function uploadFile(file, purpose) {
  const fd = new FormData();
  fd.append('purpose', purpose);
  fd.append('file', file);
  const { data } = await api.post('/files', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  return data;
}

export const fileUrl = (id) => (id ? `${BASE}/files/${id}` : null);
