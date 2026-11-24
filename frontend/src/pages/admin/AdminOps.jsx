import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, downloadFile, errorMessage, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { StackedBars } from '../../components/Charts';
import { ErrorState, ListSkeleton, PageHeader, Section, StatCard, useConfirm, useDebounced } from '../../components/common';
import { SecurityEventChip } from '../../components/security/SecurityUi';
import { fmtDateTime, fmtRelative } from '../../utils/format';
import { ROLE_LABEL } from '../../utils/labels';

const get = (url) => api.get(url).then((r) => r.data);
const useSnack = () => {
  const { enqueueSnackbar } = useSnackbar();
  return { ok: (m) => enqueueSnackbar(m, { variant: 'success' }), fail: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }) };
};

// ───────────────────────── Security centre ─────────────────────────

function UserActions({ user, compact }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const s = useSnack();
  const [reset, setReset] = useState(false);
  const [reason, setReason] = useState('');
  if (!can('security.manage')) return null;
  const done = () => qc.invalidateQueries({ queryKey: ['security'] });
  const logout = async () => {
    if (!(await confirm({ title: `إنهاء كل جلسات ${user.fullName}؟`, body: 'هيتطلب منه تسجيل الدخول من جديد على كل الأجهزة.', confirmText: 'إنهاء الجلسات', danger: true }))) return;
    try {
      await api.post(`/security/users/${user.id}/logout-all`);
      s.ok('تم إنهاء كل الجلسات');
      done();
    } catch (e) {
      s.fail(e);
    }
  };
  const doReset = async () => {
    try {
      await api.post(`/security/users/${user.id}/reset-2fa`, { reason });
      s.ok('تمت إعادة ضبط التحقق بخطوتين');
      setReset(false);
      setReason('');
      done();
    } catch (e) {
      s.fail(e);
    }
  };
  return (
    <>
      <Stack direction="row" spacing={0.5}>
        {user.twoFactorEnabled && <Button size="small" onClick={() => setReset(true)}>{compact ? 'ضبط 2FA' : 'إعادة ضبط 2FA'}</Button>}
        <Button size="small" color="error" onClick={logout}>{compact ? 'خروج' : 'خروج من كل الأجهزة'}</Button>
      </Stack>
      <Dialog open={reset} onClose={() => setReset(false)} maxWidth="xs" fullWidth>
        <DialogTitle>إعادة ضبط التحقق بخطوتين — {user.fullName}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>استخدمها فقط بعد التأكد من هوية صاحب الحساب (فقد موبايله والأكواد الاحتياطية). هيتم تسجيل خروجه من كل الأجهزة.</Alert>
          <TextField fullWidth multiline minRows={2} label="طريقة التحقق من الهوية / السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReset(false)}>إلغاء</Button>
          <Button color="error" variant="contained" disabled={reason.trim().length < 3} onClick={doReset}>إعادة ضبط</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function AdminSecurity() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const s = useSnack();
  const [days, setDays] = useState(7);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'overview', days], queryFn: () => get(`/security/overview?days=${days}`) });
  const ev = useQuery({
    queryKey: ['security', 'events', alertsOnly, action, page],
    queryFn: () => get(`/security/events${qs({ alertsOnly: alertsOnly || undefined, action, page, pageSize: 15 })}`),
    placeholderData: (p) => p,
  });
  const unlock = async (id) => {
    try {
      await api.post(`/security/users/${id}/unlock`);
      s.ok('تم فك القفل');
      qc.invalidateQueries({ queryKey: ['security'] });
    } catch (e) {
      s.fail(e);
    }
  };
  const t = data?.totals;
  const staffNo2fa = (data?.staff || []).filter((x) => !x.twoFactorEnabled);
  return (
    <>
      <PageHeader
        title="مركز الأمان"
        subtitle="محاولات الدخول، الحسابات المقفولة، العناوين المشبوهة، وتفعيل التحقق بخطوتين لفريق المنصة."
        actions={
          <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
            {[1, 7, 30].map((d) => <ToggleButton key={d} value={d}>{d === 1 ? 'آخر 24 ساعة' : `${d} يوم`}</ToggleButton>)}
          </ToggleButtonGroup>
        }
      />
      {error && <ErrorState error={error} onRetry={refetch} />}
      {data && !data.policy.require2faForStaff && staffNo2fa.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {staffNo2fa.length} من فريق المنصة بدون تحقق بخطوتين. يمكنك إلزامهم من إعدادات النظام ← <b dir="ltr">security.require2faForStaff</b>.
        </Alert>
      )}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid xs={6} md={2}><StatCard loading={isLoading} label="تسجيلات دخول" value={t?.logins ?? '—'} /></Grid>
        <Grid xs={6} md={2}><StatCard loading={isLoading} tone={t?.failedLogins ? 'accent' : 'default'} label="محاولات فاشلة" value={t?.failedLogins ?? '—'} /></Grid>
        <Grid xs={6} md={2}><StatCard loading={isLoading} label="حسابات اتقفلت" value={t?.lockouts ?? '—'} /></Grid>
        <Grid xs={6} md={2}><StatCard loading={isLoading} label="أجهزة جديدة" value={t?.newDevices ?? '—'} /></Grid>
        <Grid xs={6} md={2}><StatCard loading={isLoading} tone={t?.tokenReuse ? 'accent' : 'default'} label="جلسات مسروقة مُكتشفة" value={t?.tokenReuse ?? '—'} /></Grid>
        <Grid xs={6} md={2}><StatCard loading={isLoading} label="مفعّلو التحقق بخطوتين" value={t ? `${t.twoFactorEnabledUsers} / ${t.activeUsers}` : '—'} /></Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          <Section title="الدخول الناجح مقابل الفاشل">
            <StackedBars data={data?.daily} keys={[{ key: 'success', label: 'ناجح' }, { key: 'failed', label: 'فاشل', color: '#C2410C' }]} />
          </Section>
        </Grid>
        <Grid xs={12} md={4}>
          <Section title="سياسة الحماية">
            {data ? (
              <Stack spacing={0.75}>
                <Typography variant="body2">قفل الحساب بعد <b>{data.policy.maxFailedLogins}</b> محاولات خاطئة لمدة <b>{data.policy.lockMinutes}</b> دقيقة</Typography>
                <Typography variant="body2">التحقق بخطوتين لفريق المنصة: <b>{data.policy.require2faForStaff ? 'إجباري' : 'اختياري'}</b></Typography>
                <Typography variant="body2">تنبيه الدخول من جهاز جديد: <b>{data.policy.newDeviceAlerts ? 'مفعّل' : 'متوقف'}</b></Typography>
                <Typography variant="body2">الاحتفاظ بسجل المراجعة: <b>{data.policy.auditRetentionDays ? `${data.policy.auditRetentionDays} يوم` : 'دائماً'}</b></Typography>
                <Typography variant="caption" color="text.secondary">تتغير من إعدادات النظام (security.* و audit.retentionDays).</Typography>
              </Stack>
            ) : <ListSkeleton rows={3} height={24} />}
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="حسابات مقفولة الآن">
            {data?.locked?.length ? (
              <Stack spacing={1}>
                {data.locked.map((u) => (
                  <Stack key={u.id} direction="row" alignItems="center" spacing={1} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography fontWeight={600}>{u.fullName}</Typography>
                      <Typography variant="caption" color="text.secondary"><span dir="ltr">{u.phone}</span> • يُفتح {fmtRelative(u.lockedUntil)}</Typography>
                    </Box>
                    {can('security.manage') && <Button size="small" startIcon={<LockOpenOutlined />} onClick={() => unlock(u.id)}>فك القفل</Button>}
                  </Stack>
                ))}
              </Stack>
            ) : <Typography color="text.secondary" variant="body2">لا يوجد حسابات مقفولة.</Typography>}
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="عناوين IP بأكثر محاولات فاشلة">
            {data?.topIps?.length ? (
              <Table size="small">
                <TableHead><TableRow><TableCell>IP</TableCell><TableCell>محاولات</TableCell><TableCell>حسابات</TableCell><TableCell>آخر محاولة</TableCell></TableRow></TableHead>
                <TableBody>
                  {data.topIps.map((r) => (
                    <TableRow key={r.ip} sx={{ bgcolor: r.failures >= 10 ? 'rgba(194,65,12,.06)' : undefined }}>
                      <TableCell dir="ltr" sx={{ fontFamily: 'monospace' }}>{r.ip}</TableCell>
                      <TableCell>{r.failures}</TableCell>
                      <TableCell>{r.accounts}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtRelative(r.lastAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <Typography color="text.secondary" variant="body2">لا توجد محاولات فاشلة في الفترة.</Typography>}
          </Section>
        </Grid>
        <Grid xs={12}>
          <Section title="فريق المنصة والتحقق بخطوتين">
            <DataTable
              dense
              loading={isLoading}
              rows={data?.staff || []}
              columns={[
                { key: 'fullName', label: 'الاسم', render: (r) => <Stack><span>{r.fullName}</span><Typography variant="caption" color="text.secondary" dir="ltr" textAlign="right">{r.email || r.phone}</Typography></Stack> },
                { key: 'roles', label: 'الدور', render: (r) => r.roles.map((x) => ROLE_LABEL[x] || x).join('، ') },
                { key: 'twoFactorEnabled', label: 'التحقق بخطوتين', render: (r) => <Chip size="small" color={r.twoFactorEnabled ? 'success' : 'warning'} label={r.twoFactorEnabled ? 'مفعّل' : 'غير مفعّل'} /> },
                { key: 'lastLoginAt', label: 'آخر دخول', nowrap: true, render: (r) => (r.lastLoginAt ? fmtDateTime(r.lastLoginAt) : '—') },
                { key: 'a', label: '', render: (r) => <UserActions user={r} compact /> },
              ]}
            />
          </Section>
        </Grid>
        <Grid xs={12}>
          <Section
            title="أحداث الأمان"
            action={
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField select size="small" label="الحدث" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} sx={{ minWidth: 190 }}>
                  <MenuItem value="">الكل</MenuItem>
                  {['LOGIN_FAILED', 'ACCOUNT_LOCKED', 'NEW_DEVICE_LOGIN', 'TWO_FACTOR_FAILED', 'REFRESH_TOKEN_REUSE_DETECTED', 'PASSWORD_RESET', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'FORCE_LOGOUT'].map((a) => (
                    <MenuItem key={a} value={a}><SecurityEventChip action={a} /></MenuItem>
                  ))}
                </TextField>
                <FormControlLabel control={<Switch size="small" checked={alertsOnly} onChange={(e) => { setAlertsOnly(e.target.checked); setPage(1); }} />} label="المهم فقط" />
              </Stack>
            }
          >
            <DataTable
              dense
              loading={ev.isLoading}
              rows={ev.data?.items || []}
              total={ev.data?.total || 0}
              page={page}
              pageSize={15}
              onPageChange={setPage}
              columns={[
                { key: 'at', label: 'الوقت', nowrap: true, render: (r) => fmtDateTime(r.at) },
                { key: 'action', label: 'الحدث', render: (r) => <SecurityEventChip action={r.action} /> },
                { key: 'user', label: 'الحساب', render: (r) => (r.user ? <Stack><span>{r.user.fullName}</span><Typography variant="caption" dir="ltr" textAlign="right" color="text.secondary">{r.user.phone}</Typography></Stack> : <Typography variant="caption" dir="ltr">{r.identifier || '—'}</Typography>) },
                { key: 'ip', label: 'IP', nowrap: true, render: (r) => <span dir="ltr">{r.ip || '—'}</span> },
                { key: 'device', label: 'الجهاز' },
              ]}
            />
          </Section>
        </Grid>
      </Grid>
    </>
  );
}

// ───────────────────────── Audit log ─────────────────────────

function JsonBlock({ value }) {
  if (value == null) return <Typography variant="body2" color="text.secondary">—</Typography>;
  return (
    <Box component="pre" dir="ltr" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 2, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto' }}>
      {JSON.stringify(value, null, 2)}
    </Box>
  );
}

/** Field-level differences between old and new values. */
function Diff({ oldValue, newValue }) {
  if (!oldValue || !newValue || typeof oldValue !== 'object' || typeof newValue !== 'object') return null;
  const keys = [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].filter((k) => JSON.stringify(oldValue[k]) !== JSON.stringify(newValue[k]));
  if (!keys.length) return null;
  return (
    <Table size="small">
      <TableHead><TableRow><TableCell>الحقل</TableCell><TableCell>قبل</TableCell><TableCell>بعد</TableCell></TableRow></TableHead>
      <TableBody>
        {keys.map((k) => (
          <TableRow key={k}>
            <TableCell dir="ltr" sx={{ fontFamily: 'monospace' }}>{k}</TableCell>
            <TableCell sx={{ color: 'error.main', wordBreak: 'break-word' }}>{oldValue[k] === undefined ? '—' : JSON.stringify(oldValue[k])}</TableCell>
            <TableCell sx={{ color: 'success.main', wordBreak: 'break-word' }}>{newValue[k] === undefined ? '—' : JSON.stringify(newValue[k])}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AuditDrawer({ row, onClose, onEntity }) {
  return (
    <Drawer anchor="left" open={!!row} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, p: 2 } }}>
      {row && (
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6" dir="ltr">{row.action}</Typography>
            <IconButton onClick={onClose} aria-label="إغلاق"><CloseIcon /></IconButton>
          </Stack>
          <Typography><b>الوقت:</b> {fmtDateTime(row.createdAt)}</Typography>
          <Typography><b>المستخدم:</b> {row.user ? `${row.user.fullName} (${row.user.phone})` : 'النظام'}</Typography>
          <Typography><b>العنصر:</b> <span dir="ltr">{row.entity}{row.entityId ? ` / ${row.entityId}` : ''}</span></Typography>
          <Typography><b>IP / الجهاز:</b> <span dir="ltr">{row.ip || '—'}</span> • {row.device}</Typography>
          {row.entityId && <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => onEntity(row.entity, row.entityId)}>كل سجل هذا العنصر</Button>}
          <Diff oldValue={row.oldValue} newValue={row.newValue} />
          <Typography variant="subtitle2">القيمة السابقة</Typography>
          <JsonBlock value={row.oldValue} />
          <Typography variant="subtitle2">القيمة الجديدة</Typography>
          <JsonBlock value={row.newValue} />
          <Typography variant="caption" color="text.secondary">السجل للإضافة فقط — لا يمكن تعديله أو حذفه من التطبيق. كلمات المرور والأكواد تُحجب تلقائياً.</Typography>
        </Stack>
      )}
    </Drawer>
  );
}

export function AdminAudit() {
  const s = useSnack();
  const [f, setF] = useState({ category: '', action: '', user: '', ip: '', from: '', to: '', entity: '', entityId: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const user = useDebounced(f.user);
  const ip = useDebounced(f.ip);
  const params = { ...f, user, ip: /^[\d.:a-fA-F]+$/.test(ip) ? ip : '', page, pageSize: 25 };
  const cats = useQuery({ queryKey: ['audit', 'categories'], queryFn: () => get('/audit-logs/categories'), staleTime: Infinity });
  const actions = useQuery({ queryKey: ['audit', 'actions'], queryFn: () => get('/audit-logs/actions') });
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['audit', params], queryFn: () => get(`/audit-logs${qs(params)}`), placeholderData: (p) => p });
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setPage(1);
  };
  const exportCsv = async () => {
    setBusy(true);
    try {
      const filters = { ...params };
      delete filters.page;
      delete filters.pageSize;
      await downloadFile(`/audit-logs/export.csv${qs(filters)}`, `audit-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const catLabel = Object.fromEntries((cats.data || []).map((c) => [c.key, c.label]));
  return (
    <>
      <PageHeader
        title="سجل المراجعة"
        subtitle="كل عملية حساسة على المنصة: مين عمل إيه، إمتى، ومن أي جهاز — للإضافة فقط ولا يمكن تعديله."
        actions={<Button variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <DownloadOutlined />} onClick={exportCsv} disabled={busy}>تصدير CSV</Button>}
      />
      <Card sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={1.5}>
          <Grid xs={12} sm={6} md={3}>
            <TextField fullWidth select size="small" label="التصنيف" value={f.category} onChange={set('category')}>
              <MenuItem value="">الكل</MenuItem>
              {(cats.data || []).map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid xs={12} sm={6} md={3}>
            <TextField fullWidth select size="small" label="الإجراء" value={f.action} onChange={set('action')}>
              <MenuItem value="">الكل</MenuItem>
              {(actions.data || []).map((a) => <MenuItem key={a} value={a} dir="ltr">{a}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid xs={12} sm={6} md={3}>
            <TextField fullWidth size="small" label="المستخدم (اسم / هاتف / بريد)" value={f.user} onChange={set('user')} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
          </Grid>
          <Grid xs={12} sm={6} md={3}>
            <TextField fullWidth size="small" label="IP" value={f.ip} onChange={set('ip')} inputProps={{ dir: 'ltr' }} />
          </Grid>
          <Grid xs={6} md={3}><TextField fullWidth size="small" type="date" label="من" InputLabelProps={{ shrink: true }} value={f.from} onChange={set('from')} /></Grid>
          <Grid xs={6} md={3}><TextField fullWidth size="small" type="date" label="إلى" InputLabelProps={{ shrink: true }} value={f.to} onChange={set('to')} /></Grid>
          {f.entityId && (
            <Grid xs={12} md={6}>
              <Chip label={`عنصر: ${f.entity} / ${f.entityId.slice(0, 8)}…`} onDelete={() => setF({ ...f, entity: '', entityId: '' })} />
            </Grid>
          )}
        </Grid>
      </Card>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          dense
          loading={isLoading}
          rows={data?.items || []}
          total={data?.total || 0}
          page={page}
          pageSize={25}
          onPageChange={setPage}
          onRowClick={setOpen}
          columns={[
            { key: 'createdAt', label: 'الوقت', nowrap: true, render: (r) => fmtDateTime(r.createdAt) },
            { key: 'action', label: 'الإجراء', render: (r) => <Stack><Typography variant="body2" dir="ltr" textAlign="right" fontWeight={600}>{r.action}</Typography><Typography variant="caption" color="text.secondary">{catLabel[r.category] || 'أخرى'}</Typography></Stack> },
            { key: 'user', label: 'المستخدم', render: (r) => (r.user ? <Stack><span>{r.user.fullName}</span><Typography variant="caption" dir="ltr" textAlign="right" color="text.secondary">{r.user.phone}</Typography></Stack> : 'النظام') },
            { key: 'entity', label: 'العنصر', render: (r) => <Typography variant="caption" dir="ltr">{r.entity}{r.entityId ? ` / ${String(r.entityId).slice(0, 8)}` : ''}</Typography> },
            { key: 'ip', label: 'IP / الجهاز', render: (r) => <Stack><span dir="ltr">{r.ip || '—'}</span><Typography variant="caption" color="text.secondary">{r.device}</Typography></Stack> },
          ]}
        />
      </Card>
      <AuditDrawer
        row={open}
        onClose={() => setOpen(null)}
        onEntity={(entity, entityId) => {
          setF({ ...f, entity, entityId, category: '', action: '' });
          setPage(1);
          setOpen(null);
        }}
      />
    </>
  );
}

// ───────────────────────── System health ─────────────────────────

/** Keeps "120 ms" in reading order inside RTL text. */
const Ms = ({ v }) => <span dir="ltr">{v} ms</span>;

const fmtUptime = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} يوم ${h} ساعة` : h ? `${h} ساعة ${m} دقيقة` : `${m} دقيقة`;
};

export function AdminSystemHealth() {
  const s = useSnack();
  const qc = useQueryClient();
  const { data: h, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ['system', 'health'], queryFn: () => get('/system/health'), refetchInterval: 15_000 });
  const act = async (url, msg) => {
    try {
      await api.post(url);
      s.ok(msg);
      qc.invalidateQueries({ queryKey: ['system'] });
    } catch (e) {
      s.fail(e);
    }
  };
  if (isLoading) return <ListSkeleton rows={4} height={100} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const pool = h.database.pool;
  return (
    <>
      <PageHeader
        title="صحة النظام"
        subtitle="الخادم وقاعدة البيانات وأبطأ الطلبات والاستعلامات — تتحدث كل 15 ثانية."
        actions={[
          <Button key="r" startIcon={isFetching ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={() => refetch()}>تحديث</Button>,
          <Button key="c" variant="outlined" onClick={() => act('/system/cache/clear', 'تم مسح الكاش')}>مسح الكاش</Button>,
          <Button key="m" variant="outlined" onClick={() => act('/system/metrics/reset', 'تم تصفير الإحصائيات')}>تصفير الإحصائيات</Button>,
        ]}
      />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid xs={6} md={3}><StatCard tone="primary" label="يعمل منذ" value={fmtUptime(h.process.uptimeSeconds)} hint={`Node ${h.process.node}`} /></Grid>
        <Grid xs={6} md={3}><StatCard label="زمن استجابة قاعدة البيانات" value={<Ms v={h.database.latencyMs} />} hint={`${h.database.sizeMb} MB • ${h.database.connections} اتصال`} /></Grid>
        <Grid xs={6} md={3}><StatCard tone={h.http.errorRate > 1 ? 'accent' : 'default'} label="الطلبات / أخطاء الخادم" value={`${h.http.requests.toLocaleString('en-US')}`} hint={`5xx: ${h.http.errors5xx} (${h.http.errorRate}%) • 4xx: ${h.http.errors4xx}`} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الكاش" value={`${h.cache.hitRate}%`} hint={`${h.cache.hits} إصابة • ${h.cache.entries} عنصر`} /></Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid xs={12} md={4}>
          <Section title="العملية">
            <Stack spacing={1}>
              <Typography variant="body2">الذاكرة: {h.process.memoryMb.rss} MB (Heap {h.process.memoryMb.heapUsed}/{h.process.memoryMb.heapTotal})</Typography>
              <LinearProgress variant="determinate" value={Math.min(100, (h.process.memoryMb.heapUsed / h.process.memoryMb.heapTotal) * 100)} />
              <Typography variant="body2">تأخير الـ event loop: p50 <Ms v={h.process.eventLoopDelayMs.p50} /> • p99 <Ms v={h.process.eventLoopDelayMs.p99} /></Typography>
              <Typography variant="body2">المعالجات: {h.process.host.cpus} • الحمل: {h.process.host.load1}</Typography>
              <Typography variant="body2">ذاكرة الجهاز المتاحة: {h.process.host.freeMemMb} / {h.process.host.totalMemMb} MB</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2">توليد PDF:</Typography>
                {h.pdf.available ? <Chip size="small" color="success" label="متاح" /> : <Chip size="small" color="warning" label="غير متاح (CHROMIUM_PATH)" />}
              </Stack>
            </Stack>
          </Section>
        </Grid>
        <Grid xs={12} md={4}>
          <Section title="قاعدة البيانات">
            <Stack spacing={1}>
              <Typography variant="body2" dir="ltr" textAlign="right">{h.database.version}</Typography>
              {pool && <Typography variant="body2">الاتصالات: {pool.total} مفتوح • {pool.idle} خامل • {pool.waiting} في الانتظار (حد {pool.max})</Typography>}
              <Typography variant="body2">نسبة القراءة من الذاكرة: <b>{h.database.cacheHitRatio ?? '—'}%</b></Typography>
              <Typography variant="body2">استخدام الفهارس: <b>{h.database.indexUsageRatio ?? '—'}%</b></Typography>
            </Stack>
          </Section>
        </Grid>
        <Grid xs={12} md={4}>
          <Section title="المهام المجدولة">
            <Stack spacing={0.75}>
              <Typography variant="body2">مهام في الخلفية الآن: {h.jobs.pending}</Typography>
              {h.jobs.crons.map((c) => (
                <Stack key={c.name} direction="row" justifyContent="space-between">
                  <Typography variant="caption" dir="ltr">{c.name}</Typography>
                  <Typography variant="caption" color="text.secondary">التالية {c.next ? fmtRelative(c.next) : '—'}</Typography>
                </Stack>
              ))}
            </Stack>
          </Section>
        </Grid>
        <Grid xs={12} lg={7}>
          <Section title="أبطأ نقاط الـ API (p95)">
            <DataTable
              dense
              rows={h.http.slowest.map((r) => ({ ...r, id: r.route }))}
              columns={[
                { key: 'route', label: 'المسار', render: (r) => <Typography variant="caption" dir="ltr" sx={{ fontFamily: 'monospace' }}>{r.route}</Typography> },
                { key: 'count', label: 'عدد' },
                { key: 'p50Ms', label: 'p50', nowrap: true, render: (r) => <Ms v={r.p50Ms} /> },
                { key: 'p95Ms', label: 'p95', nowrap: true, render: (r) => <b style={{ color: r.p95Ms > 1000 ? '#B3261E' : undefined }}><Ms v={r.p95Ms} /></b> },
                { key: 'maxMs', label: 'أقصى', nowrap: true, render: (r) => <Ms v={r.maxMs} /> },
                { key: 'errors', label: '5xx' },
              ]}
              empty={<Typography color="text.secondary" sx={{ p: 2 }}>لا توجد طلبات مسجلة بعد.</Typography>}
            />
          </Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="أكبر الجداول">
            <DataTable
              dense
              rows={h.database.tables.map((t) => ({ ...t, id: t.table }))}
              columns={[
                { key: 'table', label: 'الجدول', render: (r) => <Typography variant="caption" dir="ltr" sx={{ fontFamily: 'monospace' }}>{r.table}</Typography> },
                { key: 'rows', label: 'صفوف', render: (r) => r.rows.toLocaleString('en-US') },
                { key: 'sizeMb', label: 'الحجم', nowrap: true, render: (r) => `${r.sizeMb} MB` },
                { key: 'scan', label: 'فهرس / كامل', nowrap: true, render: (r) => `${r.idxScans.toLocaleString('en-US')} / ${r.seqScans.toLocaleString('en-US')}` },
              ]}
            />
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="آخر الطلبات البطيئة">
            {h.http.slowRequests.length ? (
              <Stack spacing={0.75}>
                {h.http.slowRequests.map((r, i) => (
                  <Stack key={i} direction="row" justifyContent="space-between" spacing={1}>
                    <Typography variant="caption" dir="ltr" sx={{ fontFamily: 'monospace' }} noWrap>{r.route}</Typography>
                    <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}><Ms v={r.ms} /> • {fmtRelative(r.at)}</Typography>
                  </Stack>
                ))}
              </Stack>
            ) : <Typography variant="body2" color="text.secondary">لا يوجد — كل الطلبات أسرع من الحد المضبوط (SLOW_REQUEST_MS).</Typography>}
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="آخر الاستعلامات البطيئة">
            {h.slowQueries.length ? (
              <Stack spacing={1}>
                {h.slowQueries.map((q, i) => (
                  <Box key={i}>
                    <Typography variant="caption" color="text.secondary"><Ms v={q.ms} /> • {fmtRelative(q.at)}</Typography>
                    <Box component="pre" dir="ltr" sx={{ m: 0, p: 1, fontSize: 11, bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{q.query}</Box>
                  </Box>
                ))}
              </Stack>
            ) : <Typography variant="body2" color="text.secondary">لا يوجد — كل الاستعلامات أسرع من SLOW_QUERY_MS.</Typography>}
          </Section>
        </Grid>
      </Grid>
    </>
  );
}
