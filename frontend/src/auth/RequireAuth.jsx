import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { homeFor, useAuth } from './AuthProvider';

/**
 * UX-level route guard only — every permission is enforced again by the API.
 * `roles`: any of; `perm`: required permission code.
 */
export default function RequireAuth({ roles, perm, children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) {
    return (
      <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (roles && !user.roles.some((r) => roles.includes(r))) return <Navigate to={homeFor(user)} replace />;
  if (perm && !user.permissions.includes(perm)) return <Navigate to={homeFor(user)} replace />;
  return children;
}
