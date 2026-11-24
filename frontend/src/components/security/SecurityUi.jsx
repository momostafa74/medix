import { useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import ContentCopy from '@mui/icons-material/ContentCopy';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Section } from '../common';
import { fmtDateTime } from '../../utils/format';

/** Labels for security events (own login history + admin security centre). */
export const SECURITY_EVENT = {
  LOGIN: { label: 'تسجيل دخول', color: 'success' },
  LOGIN_FAILED: { label: 'كلمة مرور خاطئة', color: 'warning' },
  LOGIN_BLOCKED_LOCKED: { label: 'محاولة على حساب مقفول', color: 'error' },
  ACCOUNT_LOCKED: { label: 'قفل الحساب', color: 'error' },
  ACCOUNT_UNLOCKED: { label: 'فك القفل', color: 'info' },
  NEW_DEVICE_LOGIN: { label: 'جهاز جديد', color: 'info' },
  REFRESH_TOKEN_REUSE_DETECTED: { label: 'إعادة استخدام جلسة مسروقة', color: 'error' },
  TWO_FACTOR_ENABLED: { label: 'تفعيل التحقق بخطوتين', color: 'success' },
  TWO_FACTOR_DISABLED: { label: 'إيقاف التحقق بخطوتين', color: 'warning' },
  TWO_FACTOR_FAILED: { label: 'كود تحقق خاطئ', color: 'warning' },
  TWO_FACTOR_BACKUP_CODE_USED: { label: 'دخول بكود احتياطي', color: 'info' },
  TWO_FACTOR_RESET_BY_ADMIN: { label: 'إعادة ضبط التحقق بخطوتين', color: 'warning' },
  PASSWORD_CHANGED: { label: 'تغيير كلمة المرور', color: 'info' },
  PASSWORD_RESET: { label: 'إعادة تعيين كلمة المرور', color: 'info' },
  FORCE_LOGOUT: { label: 'خروج إجباري من كل الأجهزة', color: 'warning' },
  LOGOUT_ALL: { label: 'خروج من كل الأجهزة', color: 'default' },
};

export const SecurityEventChip = ({ action }) => {
  const e = SECURITY_EVENT[action] || { label: action, color: 'default' };
  return <Chip size="small" color={e.color} variant="outlined" label={e.label} />;
};

function BackupCodes({ codes }) {
  const { enqueueSnackbar } = useSnackbar();
  const text = codes.join('\n');
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`أكواد احتياطية — ميديكس\nكل كود يُستخدم مرة واحدة.\n\n${text}\n`], { type: 'text/plain' }));
    a.download = 'medix-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <Stack spacing={1.5}>
      <Alert severity="warning">احفظ الأكواد دي في مكان آمن — هتظهر مرة واحدة بس. كل كود يدخّلك مرة واحدة لو موبايلك مش معاك.</Alert>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, p: 2, bgcolor: 'action.hover', borderRadius: 2, fontFamily: 'monospace', fontSize: 16, direction: 'ltr', textAlign: 'center' }}>
        {codes.map((c) => <span key={c}>{c}</span>)}
      </Box>
      <Stack direction="row" spacing={1}>
        <Button startIcon={<ContentCopy />} onClick={() => navigator.clipboard?.writeText(text).then(() => enqueueSnackbar('تم النسخ', { variant: 'success' }))}>نسخ</Button>
        <Button startIcon={<DownloadOutlined />} onClick={download}>تحميل ملف</Button>
      </Stack>
    </Stack>
  );
}

/** Enrol / manage two-step verification (Settings page). */
export function TwoFactorSection({ sx }) {
  const qc = useQueryClient();
  const { reload } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const { data: st } = useQuery({ queryKey: ['2fa'], queryFn: () => api.get('/auth/2fa').then((r) => r.data) });
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [disable, setDisable] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['2fa'] });
    await reload();
  };
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const start = () => run(async () => setSetup((await api.post('/auth/2fa/setup')).data));
  const enable = () =>
    run(async () => {
      const r = await api.post('/auth/2fa/enable', { code });
      setCodes(r.data.backupCodes);
      setSetup(null);
      setCode('');
      await refresh();
    });
  const regenerate = () =>
    run(async () => {
      const r = await api.post('/auth/2fa/backup-codes', { code });
      setCodes(r.data.backupCodes);
      setCode('');
      await refresh();
    });
  const off = () =>
    run(async () => {
      await api.post('/auth/2fa/disable', { password, code });
      setDisable(false);
      setPassword('');
      setCode('');
      enqueueSnackbar('تم إيقاف التحقق بخطوتين', { variant: 'success' });
      await refresh();
    });
  const codeField = (
    <TextField
      size="small"
      label="الكود من التطبيق"
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/[^\dA-Za-z-]/g, '').slice(0, 9))}
      inputProps={{ dir: 'ltr', inputMode: 'numeric', 'aria-label': 'كود التحقق', style: { letterSpacing: 4, textAlign: 'center' } }}
      sx={{ width: 180 }}
    />
  );

  return (
    <Section title="التحقق بخطوتين" sx={sx} action={st?.enabled ? <Chip color="success" icon={<VerifiedUserOutlined />} label="مفعّل" size="small" /> : <Chip label="غير مفعّل" size="small" />}>
      {st?.required && !st.enabled && <Alert severity="error" sx={{ mb: 1.5 }}>مطلوب لحسابات فريق المنصة — فعّله لتقدر تستخدم لوحة الإدارة.</Alert>}
      {codes ? (
        <Stack spacing={1.5}>
          <BackupCodes codes={codes} />
          <Button variant="contained" onClick={() => setCodes(null)} sx={{ alignSelf: 'flex-start' }}>حفظتها</Button>
        </Stack>
      ) : st?.enabled ? (
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">عند الدخول من أي جهاز هيُطلب كود من تطبيق المصادقة. باقي {st.backupCodesLeft} أكواد احتياطية.</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            {codeField}
            <Button onClick={regenerate} disabled={busy || code.length !== 6}>أكواد احتياطية جديدة</Button>
            <Button color="error" onClick={() => setDisable(true)}>إيقاف</Button>
          </Stack>
        </Stack>
      ) : setup ? (
        <Stack spacing={1.5}>
          <Typography variant="body2">1) امسح الكود بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو Authy).</Typography>
          <Box component="img" src={setup.qrDataUrl} alt="QR للتحقق بخطوتين" sx={{ width: 180, height: 180, alignSelf: 'center', border: 1, borderColor: 'divider', borderRadius: 2 }} />
          <Typography variant="caption" color="text.secondary">
            أو اكتب المفتاح يدوياً: <Box component="span" dir="ltr" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{setup.secret}</Box>
          </Typography>
          <Typography variant="body2">2) اكتب الكود المكون من 6 أرقام اللي ظاهر في التطبيق:</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            {codeField}
            <Button variant="contained" onClick={enable} disabled={busy || code.length !== 6}>{busy ? <CircularProgress size={18} /> : 'تفعيل'}</Button>
            <Button onClick={() => setSetup(null)}>إلغاء</Button>
          </Stack>
        </Stack>
      ) : (
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant="body2" color="text.secondary">طبقة حماية إضافية: حتى لو حد عرف كلمة المرور مش هيقدر يدخل من غير موبايلك.</Typography>
          <Button variant="contained" startIcon={<VerifiedUserOutlined />} onClick={start} disabled={busy}>تفعيل التحقق بخطوتين</Button>
        </Stack>
      )}
      <Dialog open={disable} onClose={() => setDisable(false)} maxWidth="xs" fullWidth>
        <DialogTitle>إيقاف التحقق بخطوتين</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField type="password" label="كلمة المرور" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <TextField label="كود التطبيق أو كود احتياطي" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))} inputProps={{ dir: 'ltr' }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisable(false)}>إلغاء</Button>
          <Button color="error" variant="contained" onClick={off} disabled={busy || !password || code.length < 6}>إيقاف</Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

/** The user's own recent sign-ins and security events. */
export function LoginHistorySection({ sx }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['login-history'], queryFn: () => api.get('/auth/login-history').then((r) => r.data) });
  return (
    <Section title="سجل الدخول والأمان" sx={sx}>
      {isLoading ? null : data.length ? (
        <Stack spacing={1} sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {data.map((e, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <SecurityEventChip action={e.action} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>{e.device}{e.ip ? ` • ${e.ip}` : ''}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.at)}</Typography>
            </Stack>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">لا توجد أحداث بعد.</Typography>
      )}
    </Section>
  );
}
