import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { errorMessage } from '../api/client';
import { tokens } from '../theme';

export function Brand({ size = 'md', light = false }) {
  const s = size === 'lg' ? 34 : 28;
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Box component="svg" viewBox="0 0 32 32" sx={{ width: s, height: s, flexShrink: 0 }} aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? '#fff' : tokens.petrol} />
        <path d="M13 8h6v5h5v6h-5v5h-6v-5H8v-6h5z" fill={tokens.saffron} />
      </Box>
      <Typography sx={{ fontWeight: 700, fontSize: size === 'lg' ? 24 : 20, color: light ? '#fff' : tokens.petrol }}>
        ميديكس
      </Typography>
    </Stack>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      justifyContent="space-between"
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box>
        {back}
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function StatusChip({ value, map, size = 'small' }) {
  const m = map[value] || { label: value, color: 'default' };
  return <Chip size={size} label={m.label} color={m.color} variant={m.color === 'default' ? 'outlined' : 'filled'} />;
}

export function EmptyState({ title, body, action, icon }) {
  return (
    <Box sx={{ py: 6, px: 2, textAlign: 'center', maxWidth: 440, mx: 'auto' }}>
      {icon && <Box sx={{ color: 'text.secondary', mb: 1, '& svg': { fontSize: 40 } }}>{icon}</Box>}
      <Typography variant="h6">{title}</Typography>
      {body && (
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {body}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Alert
      severity="error"
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        )
      }
    >
      {errorMessage(error)}
    </Alert>
  );
}

export function StatCard({ label, value, hint, tone = 'default', loading }) {
  const bg = tone === 'primary' ? tokens.petrol : tone === 'accent' ? tokens.saffronSoft : '#fff';
  const fg = tone === 'primary' ? '#fff' : tokens.ink;
  return (
    <Card sx={{ p: 2.25, bgcolor: bg, color: fg, borderColor: tone === 'primary' ? tokens.petrol : undefined, height: '100%' }}>
      <Typography variant="body2" sx={{ opacity: tone === 'primary' ? 0.85 : 1, color: tone === 'primary' ? 'inherit' : 'text.secondary' }}>
        {label}
      </Typography>
      {loading ? (
        <Skeleton width={80} height={40} />
      ) : (
        <Typography sx={{ fontSize: 28, fontWeight: 700, lineHeight: 1.3, mt: 0.5 }}>{value}</Typography>
      )}
      {hint && (
        <Typography variant="caption" sx={{ opacity: 0.8 }}>
          {hint}
        </Typography>
      )}
    </Card>
  );
}

export function ListSkeleton({ rows = 5, height = 56 }) {
  return (
    <Stack spacing={1}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={height} />
      ))}
    </Stack>
  );
}

// ───────── Confirmation dialogs (destructive actions) ─────────
const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  const confirm = useCallback((opts) => {
    setState(opts);
    return new Promise((res) => (resolver.current = res));
  }, []);
  const close = (v) => {
    resolver.current?.(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onClose={() => close(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{state?.title}</DialogTitle>
        {state?.body && (
          <DialogContent>
            <DialogContentText>{state.body}</DialogContentText>
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => close(false)}>{state?.cancelText || 'تراجع'}</Button>
          <Button variant="contained" color={state?.danger ? 'error' : 'primary'} onClick={() => close(true)} autoFocus>
            {state?.confirmText || 'تأكيد'}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function Section({ title, action, children, sx }) {
  return (
    <Card sx={{ p: { xs: 2, md: 2.5 }, ...sx }}>
      {(title || action) && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6" component="h2">
            {title}
          </Typography>
          {action}
        </Stack>
      )}
      {children}
    </Card>
  );
}
