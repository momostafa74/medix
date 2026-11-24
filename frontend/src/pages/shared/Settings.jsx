import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Box, Button, Checkbox, Chip, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, setAccessToken } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader, Section, useConfirm } from '../../components/common';
import { PasswordField } from '../public/AuthPages';
import FileUploadButton from '../../components/FileUploadButton';
import { fmtDateTime } from '../../utils/format';
import { LoginHistorySection, TwoFactorSection } from '../../components/security/SecurityUi';

const PASSWORD = /^(?=.*[A-Za-z؀-ۿ])(?=.*\d).{8,72}$/;
const CATEGORIES = {
  APPOINTMENTS: 'المواعيد',
  CHAT: 'الرسائل',
  LAB_RESULTS: 'نتائج التحاليل',
  RADIOLOGY: 'تقارير الأشعة',
  PRESCRIPTIONS: 'الروشتات',
  PHARMACY: 'طلبات الصيدلية',
  PAYMENTS: 'المدفوعات',
  SYSTEM: 'تنبيهات الحساب',
  MARKETING: 'العروض والأخبار',
};
const CHANNELS = { IN_APP: 'داخل التطبيق', EMAIL: 'البريد', SMS: 'رسائل SMS', WHATSAPP: 'واتساب' };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="الإعدادات والأمان" />
      <Grid container spacing={2}>
        <Grid xs={12} lg={6}>
          <AccountSection />
          <PasswordSection />
        </Grid>
        <Grid xs={12} lg={6}>
          <TwoFactorSection />
          <VerificationSection />
          <SessionsSection />
        </Grid>
        <Grid xs={12} lg={6}>
          <LoginHistorySection />
        </Grid>
        <Grid xs={12}>
          <PreferencesSection />
        </Grid>
      </Grid>
    </>
  );
}

function AccountSection() {
  const { user, reload } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const { register, handleSubmit, formState } = useForm({ defaultValues: { fullName: user.fullName, email: user.email || '' } });
  const save = async (v) => {
    try {
      await api.patch('/users/me', { fullName: v.fullName, ...(v.email ? { email: v.email } : {}) });
      await reload();
      enqueueSnackbar('تم الحفظ', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const setAvatar = async (f) => {
    await api.patch('/users/me', { avatarFileId: f.id });
    await reload();
    enqueueSnackbar('تم تحديث الصورة', { variant: 'success' });
  };
  return (
    <Section title="بيانات الحساب">
      <Stack component="form" spacing={2} onSubmit={handleSubmit(save)}>
        <TextField label="الاسم" {...register('fullName', { required: true, minLength: 3 })} />
        <TextField label="رقم الموبايل" value={user.phone} disabled inputProps={{ dir: 'ltr' }} helperText="لتغيير رقم الموبايل تواصل مع الدعم" />
        <TextField label="البريد الإلكتروني" type="email" inputProps={{ dir: 'ltr' }} {...register('email')} />
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>حفظ التغييرات</Button>
          <FileUploadButton purpose="AVATAR" accept="image/jpeg,image/png,image/webp" maxMb={3} label="تغيير الصورة الشخصية" onUploaded={setAvatar} />
        </Stack>
      </Stack>
    </Section>
  );
}

function PasswordSection() {
  const { applyAuth } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const { handleSubmit, control, reset, formState } = useForm({ defaultValues: { currentPassword: '', newPassword: '' } });
  const save = async (v) => {
    try {
      const { data } = await api.post('/auth/change-password', v);
      setAccessToken(data.accessToken);
      applyAuth(data);
      reset();
      enqueueSnackbar('تم تغيير كلمة المرور وتسجيل الخروج من الأجهزة الأخرى', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Section title="تغيير كلمة المرور" sx={{ mt: 2 }}>
      <Stack component="form" spacing={2} onSubmit={handleSubmit(save)}>
        <Controller name="currentPassword" control={control} rules={{ required: true }} render={({ field }) => <PasswordField field={field} label="كلمة المرور الحالية" autoComplete="current-password" />} />
        <Controller name="newPassword" control={control} rules={{ required: true, pattern: PASSWORD }} render={({ field, fieldState }) => <PasswordField field={field} label="كلمة المرور الجديدة" autoComplete="new-password" error={!!fieldState.error} helperText="8 أحرف على الأقل وتحتوي على حروف وأرقام" />} />
        <Box>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>تغيير كلمة المرور</Button>
        </Box>
      </Stack>
    </Section>
  );
}

function VerificationSection() {
  const { user, reload } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const [code, setCode] = useState('');
  const [dev, setDev] = useState(null);
  const request = async (channel) => {
    try {
      const { data } = await api.post('/auth/verification/request', { channel });
      setDev(data.devToken || null);
      enqueueSnackbar(channel === 'PHONE' ? 'تم إرسال كود التحقق' : 'تم إرسال رابط التأكيد إلى بريدك', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const confirm = async () => {
    try {
      await api.post('/auth/verification/confirm', { token: code.trim() });
      await reload();
      setCode('');
      enqueueSnackbar('تم التحقق', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Section title="التحقق من الحساب" sx={{ mt: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography>رقم الموبايل</Typography>
          {user.phoneVerified ? <Chip color="success" size="small" label="تم التحقق" /> : <Button size="small" onClick={() => request('PHONE')}>إرسال كود</Button>}
        </Stack>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography>البريد الإلكتروني</Typography>
          {user.emailVerified ? <Chip color="success" size="small" label="تم التحقق" /> : user.email ? <Button size="small" onClick={() => request('EMAIL')}>إرسال رابط التأكيد</Button> : <Typography variant="body2" color="text.secondary">لم يتم إضافة بريد</Typography>}
        </Stack>
        {!user.phoneVerified && (
          <Stack direction="row" spacing={1}>
            <TextField label="كود التحقق" value={code} onChange={(e) => setCode(e.target.value)} inputProps={{ dir: 'ltr', inputMode: 'numeric' }} />
            <Button variant="outlined" onClick={confirm} disabled={!code}>تحقق</Button>
          </Stack>
        )}
        {dev && <Alert severity="info">بيئة التطوير — الكود: <b dir="ltr">{dev}</b></Alert>}
      </Stack>
    </Section>
  );
}

function SessionsSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { logout } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const { data = [] } = useQuery({ queryKey: ['sessions'], queryFn: () => api.get('/auth/sessions').then((r) => r.data) });
  const revoke = useMutation({ mutationFn: (id) => api.delete(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const all = async () => {
    if (!(await confirm({ title: 'تسجيل الخروج من كل الأجهزة؟', body: 'سيتم إنهاء كل الجلسات بما فيها هذا الجهاز.', confirmText: 'خروج من الكل', danger: true }))) return;
    await api.post('/auth/logout-all');
    enqueueSnackbar('تم تسجيل الخروج من كل الأجهزة', { variant: 'success' });
    await logout();
  };
  return (
    <Section title="الأجهزة المتصلة" sx={{ mt: 2 }} action={<Button color="error" size="small" onClick={all}>خروج من كل الأجهزة</Button>}>
      <Stack spacing={1}>
        {data.map((s) => (
          <Stack key={s.id} direction="row" alignItems="center" spacing={1}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap title={s.userAgent}>{s.device || s.userAgent || 'جهاز غير معروف'}</Typography>
              <Typography variant="caption" color="text.secondary">آخر نشاط: {fmtDateTime(s.lastUsedAt || s.createdAt)} • {s.ip}</Typography>
            </Box>
            <Tooltip title="إنهاء الجلسة">
              <IconButton size="small" onClick={() => revoke.mutate(s.id)} aria-label="إنهاء الجلسة"><DeleteOutline /></IconButton>
            </Tooltip>
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}

function PreferencesSection() {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data = [] } = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: () => api.get('/notifications/preferences').then((r) => r.data) });
  const set = useMutation({
    mutationFn: (item) => api.put('/notifications/preferences', { items: [item] }),
    onSuccess: (r) => qc.setQueryData(['notifications', 'prefs'], r.data),
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  return (
    <Section title="تفضيلات الإشعارات">
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>النوع</TableCell>
              {Object.values(CHANNELS).map((c) => <TableCell key={c} align="center">{c}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.category}>
                <TableCell>{CATEGORIES[row.category] || row.category}</TableCell>
                {Object.keys(CHANNELS).map((ch) => (
                  <TableCell key={ch} align="center">
                    <Checkbox
                      checked={!!row.channels[ch]}
                      onChange={(e) => set.mutate({ category: row.category, channel: ch, enabled: e.target.checked })}
                      inputProps={{ 'aria-label': `${CATEGORIES[row.category]} — ${CHANNELS[ch]}` }}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Section>
  );
}
