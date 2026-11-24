import { useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, fileUrl, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import AppointmentsManager from '../../components/AppointmentsManager';
import DataTable from '../../components/DataTable';
import FileUploadButton from '../../components/FileUploadButton';
import SpecialtyIcon, { SPECIALTY_ICONS } from '../../components/SpecialtyIcon';
import { PageHeader, Section } from '../../components/common';
import { fmtShortDate } from '../../utils/format';
import { ROLE_LABEL } from '../../utils/labels';
import { tokens } from '../../theme';

export function AdminAppointments() {
  return (
    <>
      <PageHeader title="كل المواعيد" />
      <AppointmentsManager scope="all" />
    </>
  );
}

// ───────────── Specialties ─────────────
export function AdminSpecialties() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(null);
  const { data = [], isLoading } = useQuery({ queryKey: ['specialties', 'admin'], queryFn: () => api.get('/specialties?includeInactive=true').then((r) => r.data) });
  const byId = Object.fromEntries(data.map((s) => [s.id, s]));
  return (
    <>
      <PageHeader title="التخصصات" subtitle="التخصص بيانات وليس دوراً — أي عدد من التخصصات يُضاف بدون تغيير في النظام." actions={<Button variant="contained" onClick={() => setEdit({})}>تخصص جديد</Button>} />
      <Card>
        <DataTable
          loading={isLoading}
          rows={data}
          columns={[
            { key: 'icon', label: '', render: (s) => (s.imageFileId ? <Avatar src={fileUrl(s.imageFileId)} variant="rounded" /> : <Avatar variant="rounded" sx={{ bgcolor: tokens.mint, color: tokens.petrol }}><SpecialtyIcon name={s.icon} /></Avatar>) },
            { key: 'nameAr', label: 'الاسم', render: (s) => <Box><b>{s.nameAr}</b><Typography variant="caption" display="block" color="text.secondary">{s.nameEn}</Typography></Box> },
            { key: 'parent', label: 'فرعي من', render: (s) => byId[s.parentId]?.nameAr || '—' },
            { key: 'doctorCount', label: 'أطباء' },
            { key: 'sortOrder', label: 'الترتيب' },
            { key: 'isActive', label: 'الحالة', render: (s) => (s.isActive ? <Chip size="small" color="success" label="مفعل" /> : <Chip size="small" label="معطل" />) },
            { key: 'e', label: '', render: (s) => <IconButton onClick={() => setEdit(s)} aria-label="تعديل"><EditOutlined /></IconButton> },
          ]}
        />
      </Card>
      {edit && <SpecialtyDialog item={edit} roots={data.filter((s) => !s.parentId && s.id !== edit.id)} onClose={() => setEdit(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['specialties'] }); setEdit(null); }} />}
    </>
  );
}

function SpecialtyDialog({ item, roots, onClose, onSaved }) {
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState({ nameAr: item.nameAr || '', nameEn: item.nameEn || '', slug: item.slug || '', description: item.description || '', parentId: item.parentId || '', icon: item.icon || 'stethoscope', sortOrder: item.sortOrder ?? 0, isActive: item.isActive ?? true, imageFileId: item.imageFileId || null });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, parentId: f.parentId || null, sortOrder: Number(f.sortOrder), description: f.description || undefined };
      return item.id ? api.patch(`/specialties/${item.id}`, body) : api.post('/specialties', body);
    },
    onSuccess: onSaved,
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{item.id ? 'تعديل تخصص' : 'تخصص جديد'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0 }}>
          <Grid xs={12} sm={6}><TextField label="الاسم بالعربية" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Grid>
          <Grid xs={12} sm={6}><TextField label="الاسم بالإنجليزية" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value, slug: item.id ? f.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} /></Grid>
          <Grid xs={12} sm={6}><TextField label="المعرف في الرابط (slug)" inputProps={{ dir: 'ltr' }} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Grid>
          <Grid xs={12} sm={6}>
            <TextField select label="فرعي من" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
              <MenuItem value="">تخصص رئيسي</MenuItem>
              {roots.map((r) => <MenuItem key={r.id} value={r.id}>{r.nameAr}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid xs={12}><TextField label="الوصف" multiline minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Grid>
          <Grid xs={8}>
            <TextField select label="الأيقونة" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })}>
              {SPECIALTY_ICONS.map((i) => <MenuItem key={i} value={i}><SpecialtyIcon name={i} sx={{ mr: 1, color: tokens.petrol }} /> {i}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid xs={4}><TextField label="الترتيب" type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Grid>
          <Grid xs={12}>
            <Stack direction="row" spacing={2} alignItems="center">
              {f.imageFileId && <Avatar src={fileUrl(f.imageFileId)} variant="rounded" sx={{ width: 56, height: 56 }} />}
              <FileUploadButton purpose="SPECIALTY_IMAGE" accept="image/jpeg,image/png,image/webp" maxMb={3} label="صورة التخصص" size="small" onUploaded={(file) => setF({ ...f, imageFileId: file.id })} />
              <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="مفعل" />
            </Stack>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !f.nameAr || !f.nameEn || !f.slug}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

// ───────────── Reviews moderation ─────────────
export function AdminReviews() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'reviews', status, page], queryFn: () => api.get(`/admin/reviews${qs({ status, page, pageSize: 20 })}`).then((r) => r.data), placeholderData: keepPreviousData });
  const moderate = useMutation({
    mutationFn: ({ id, s }) => api.patch(`/admin/reviews/${id}`, { status: s }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'reviews'] }); enqueueSnackbar('تم التحديث وإعادة حساب التقييم', { variant: 'success' }); },
  });
  return (
    <>
      <PageHeader title="مراجعة التقييمات" subtitle="إخفاء التقييم يعيد حساب متوسط تقييم مقدم الخدمة فوراً." />
      <Card>
        <Tabs value={status} onChange={(_, v) => { setStatus(v); setPage(1); }} sx={{ px: 2 }}>
          <Tab value="" label="الكل" />
          <Tab value="PUBLISHED" label="منشورة" />
          <Tab value="HIDDEN" label="مخفية" />
        </Tabs>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          columns={[
            { key: 'provider', label: 'مقدم الخدمة', render: (r) => r.provider?.nameAr },
            { key: 'patient', label: 'المريض', render: (r) => r.patient?.user?.fullName },
            { key: 'rating', label: 'التقييم', render: (r) => <Typography sx={{ color: tokens.saffron }}>{'★'.repeat(r.rating)}</Typography> },
            { key: 'comment', label: 'التعليق', render: (r) => r.comment || '—' },
            { key: 'createdAt', label: 'التاريخ', render: (r) => fmtShortDate(r.createdAt) },
            { key: 'a', label: '', render: (r) => (r.status === 'PUBLISHED' ? <Button size="small" color="error" onClick={() => moderate.mutate({ id: r.id, s: 'HIDDEN' })}>إخفاء</Button> : <Button size="small" onClick={() => moderate.mutate({ id: r.id, s: 'PUBLISHED' })}>نشر</Button>) },
          ]}
        />
      </Card>
    </>
  );
}

// ───────────── Settings & permissions ─────────────
const SETTING_LABELS = {
  'platform.name': 'اسم المنصة',
  'platform.supportPhone': 'هاتف الدعم',
  'platform.supportEmail': 'بريد الدعم',
  'platform.currency': 'العملة',
  'booking.minLeadMinutes': 'أقل مدة قبل الموعد للحجز (دقائق)',
  'booking.maxActivePerPatient': 'أقصى عدد مواعيد قادمة للمريض',
  'providers.requireApproval': 'اعتماد مقدمي الخدمة قبل الظهور',
  'emergency.hotline': 'رقم الطوارئ',
  'subscriptions.enabled': 'تفعيل اشتراكات مقدمي الخدمة (قفل غير المشتركين)',
  'subscriptions.trialDays': 'أيام التجربة المجانية',
  'subscriptions.graceDays': 'أيام السماح بعد انتهاء الاشتراك',
  'subscriptions.reminderDays': 'التذكير قبل انتهاء الاشتراك (أيام)',
  'payments.onlineEnabled': 'الدفع الأونلاين متاح',
  'payments.instapay': 'عنوان إنستاباي للتحويل',
  'payments.vodafoneCash': 'رقم فودافون كاش للتحويل',
  'payments.bankAccount': 'بيانات الحساب البنكي للتحويل',
  'security.maxFailedLogins': 'قفل الحساب بعد عدد محاولات خاطئة',
  'security.lockMinutes': 'مدة قفل الحساب (دقائق)',
  'security.require2faForStaff': 'إلزام فريق المنصة بالتحقق بخطوتين',
  'security.newDeviceAlerts': 'تنبيه عند الدخول من جهاز جديد',
  'audit.retentionDays': 'مدة الاحتفاظ بسجل المراجعة (أيام، 0 = دائماً)',
};

export function AdminSettings() {
  const { can } = useAuth();
  const [tab, setTab] = useState('system');
  return (
    <>
      <PageHeader title="إعدادات النظام" />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="system" label="الإعدادات العامة" />
        {can('roles.manage') && <Tab value="roles" label="الأدوار والصلاحيات" />}
      </Tabs>
      {tab === 'system' ? <SystemSettings /> : <RolePermissions />}
    </>
  );
}

function SystemSettings() {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data } = useQuery({ queryKey: ['settings', 'all'], queryFn: () => api.get('/settings').then((r) => r.data) });
  const [vals, setVals] = useState({});
  useEffect(() => data && setVals(data), [data]);
  const save = async (key) => {
    try {
      await api.put(`/settings/${encodeURIComponent(key)}`, { value: vals[key] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      enqueueSnackbar('تم الحفظ', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Section>
      <Stack spacing={2}>
        {Object.keys(vals).map((k) => (
          <Stack key={k} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
            <Typography sx={{ minWidth: 280 }}>{SETTING_LABELS[k] || k}</Typography>
            {typeof vals[k] === 'boolean' ? (
              <Switch checked={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.checked })} />
            ) : (
              <TextField size="small" sx={{ maxWidth: 320 }} type={typeof vals[k] === 'number' ? 'number' : 'text'} value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: typeof vals[k] === 'number' ? Number(e.target.value) : e.target.value })} />
            )}
            <Button size="small" onClick={() => save(k)} disabled={data && data[k] === vals[k]}>حفظ</Button>
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}

function RolePermissions() {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/roles').then((r) => r.data) });
  const { data: perms = [] } = useQuery({ queryKey: ['permissions'], queryFn: () => api.get('/permissions').then((r) => r.data) });
  const toggle = async (role, code, on) => {
    const next = on ? [...role.permissions.map((p) => p.code), code] : role.permissions.map((p) => p.code).filter((c) => c !== code);
    try {
      await api.put(`/roles/${role.code}/permissions`, { permissions: next });
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const editable = roles.filter((r) => r.code !== 'SUPER_ADMIN');
  return (
    <Card sx={{ overflowX: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>الصلاحية</TableCell>
            {editable.map((r) => <TableCell key={r.code} align="center" sx={{ minWidth: 90 }}>{ROLE_LABEL[r.code] || r.code}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {perms.map((p) => (
            <TableRow key={p.code} hover>
              <TableCell dir="ltr" sx={{ textAlign: 'right', fontSize: 13 }}>{p.code}</TableCell>
              {editable.map((r) => (
                <TableCell key={r.code} align="center" padding="checkbox">
                  <Checkbox size="small" checked={r.permissions.some((x) => x.code === p.code)} onChange={(e) => toggle(r, p.code, e.target.checked)} inputProps={{ 'aria-label': `${r.code} ${p.code}` }} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
