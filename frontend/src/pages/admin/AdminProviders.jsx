import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  
  InputAdornment,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import ProtectedFile from '../../components/ProtectedFile';
import { AdminLabCatalogSection, AdminRadiologyCatalogSection } from './AdminLabOrders';
import ChatButton from '../../components/ChatButton';
import { ErrorState, ListSkeleton, PageHeader, Section, StatCard, StatusChip, useDebounced } from '../../components/common';
import { fmtDateTime, fmtMoney, fmtShortDate } from '../../utils/format';
import { PROVIDER_DOC_TYPE, PROVIDER_TYPE, USER_STATUS, VERIFICATION } from '../../utils/labels';

export function AdminProviders({ fixedType, title = 'مقدمو الخدمة' }) {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [type, setType] = useState(fixedType || '');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'providers', status, type, search, page],
    queryFn: () => api.get(`/admin/providers${qs({ status, type, search, page, pageSize: 20 })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <Box sx={{ px: 2, pt: 1 }}>
          <Tabs value={status} onChange={(_, v) => { setParams(v ? { status: v } : {}); setPage(1); }} variant="scrollable">
            <Tab value="" label="الكل" />
            {Object.entries(VERIFICATION).map(([k, v]) => <Tab key={k} value={k} label={v.label} />)}
          </Tabs>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ p: 2 }}>
          <TextField placeholder="ابحث بالاسم أو موبايل/بريد المالك" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} sx={{ maxWidth: 380 }} inputProps={{ 'aria-label': 'بحث' }} />
          {!fixedType && (
            <TextField select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} sx={{ maxWidth: 200 }} inputProps={{ 'aria-label': 'النوع' }}>
              <MenuItem value="">كل الأنواع</MenuItem>
              {Object.entries(PROVIDER_TYPE).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
          )}
        </Stack>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          onRowClick={(p) => nav(`/admin/providers/${p.id}`)}
          columns={[
            { key: 'nameAr', label: 'الاسم', render: (p) => <b>{p.nameAr}</b> },
            { key: 'type', label: 'النوع', render: (p) => PROVIDER_TYPE[p.type] },
            { key: 'owner', label: 'المالك', render: (p) => <Box><Typography variant="body2">{p.owner?.fullName}</Typography><Typography variant="caption" dir="ltr">{p.owner?.phone}</Typography></Box> },
            { key: 'documentCount', label: 'مستندات', render: (p) => p.documentCount || <Chip size="small" color="warning" label="لا يوجد" /> },
            { key: 'branchCount', label: 'فروع' },
            { key: 'createdAt', label: 'تاريخ التسجيل', render: (p) => fmtShortDate(p.createdAt) },
            { key: 'status', label: 'الحالة', render: (p) => <StatusChip value={p.verificationStatus} map={VERIFICATION} /> },
          ]}
        />
      </Card>
    </>
  );
}

const ACTIONS = {
  PENDING: [{ a: 'APPROVE', label: 'اعتماد', color: 'success' }, { a: 'REJECT', label: 'رفض', color: 'error', note: true }],
  APPROVED: [{ a: 'SUSPEND', label: 'إيقاف', color: 'error', note: true }],
  SUSPENDED: [{ a: 'ACTIVATE', label: 'إعادة التفعيل', color: 'success' }],
  REJECTED: [{ a: 'APPROVE', label: 'اعتماد', color: 'success' }],
};

export function AdminProviderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const [pending, setPending] = useState(null);
  const [note, setNote] = useState('');
  const { data: p, isLoading, error } = useQuery({ queryKey: ['admin', 'provider', id], queryFn: () => api.get(`/admin/providers/${id}`).then((r) => r.data) });
  const act = useMutation({
    mutationFn: (body) => api.patch(`/admin/providers/${id}/status`, body).then((r) => r.data),
    onSuccess: (d) => { qc.setQueryData(['admin', 'provider', id], d); qc.invalidateQueries({ queryKey: ['admin', 'providers'] }); setPending(null); setNote(''); enqueueSnackbar('تم تحديث حالة الحساب وإشعار المالك', { variant: 'success' }); },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  const verify = useMutation({
    mutationFn: (docId) => api.patch(`/admin/providers/${id}/documents/${docId}/verify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'provider', id] }),
  });
  if (error) return <ErrorState error={error} />;
  if (isLoading) return <ListSkeleton rows={4} height={120} />;
  const doc = p.doctor;
  return (
    <>
      <PageHeader
        back={<Button component={RouterLink} to="/admin/providers" size="small" sx={{ mb: 1 }}>→ كل مقدمي الخدمة</Button>}
        title={p.nameAr}
        subtitle={`${PROVIDER_TYPE[p.type]} • سجّل ${fmtShortDate(p.createdAt)}`}
        actions={[
          <StatusChip key="s" value={p.verificationStatus} map={VERIFICATION} size="medium" />,
          ...(can('providers.approve') ? (ACTIONS[p.verificationStatus] || []).map((x) => (
            <Button key={x.a} variant="contained" color={x.color} onClick={() => (x.note ? setPending(x) : act.mutate({ action: x.a }))} disabled={act.isPending}>{x.label}</Button>
          )) : []),
 can('chat.support') && <ChatButton key="c" payload={{ type: 'ADMIN_PROVIDER', providerId: p.id }} label="مراسلة" />,
          p.verificationStatus === 'APPROVED' && <Button key="v" variant="outlined" component={RouterLink} to={p.type === 'DOCTOR' ? `/doctors/${p.slug}` : `/providers/${p.slug}`}>الصفحة العامة</Button>,
        ].filter(Boolean)}
      />
      {p.verificationNote && <Alert severity="info" sx={{ mb: 2 }}>ملاحظة الإدارة: {p.verificationNote}</Alert>}
      <Grid container spacing={2}>
        <Grid xs={6} md={3}><StatCard label="إجمالي الحجوزات" value={p.stats.total} /></Grid>
        <Grid xs={6} md={3}><StatCard label="مكتملة" value={p.stats.completed} /></Grid>
        <Grid xs={6} md={3}><StatCard label="ملغاة" value={p.stats.cancelled} /></Grid>
        <Grid xs={6} md={3}><StatCard label="التقييم" value={p.ratingCount ? `${p.ratingAvg} (${p.ratingCount})` : '—'} /></Grid>
        <Grid xs={12} md={6}>
          <Section title="المالك">
            <Typography component="div" sx={{ fontWeight: 600 }}>{p.owner?.fullName} <StatusChip value={p.owner?.status} map={USER_STATUS} /></Typography>
            <Typography dir="ltr" sx={{ textAlign: 'right' }}>{p.owner?.phone}</Typography>
            <Typography dir="ltr" sx={{ textAlign: 'right' }}>{p.owner?.email}</Typography>
            <Typography variant="caption" color="text.secondary">آخر دخول: {fmtDateTime(p.owner?.lastLoginAt)}</Typography>
          </Section>
          {doc && (
            <Section title="بيانات الطبيب" sx={{ mt: 2 }}>
              <Typography><b>التخصص:</b> {doc.specialties?.map((s) => s.specialty?.nameAr).join('، ')}</Typography>
              <Typography><b>الترخيص:</b> {doc.licenseNumber} — {doc.licenseAuthority}</Typography>
              <Typography><b>الخبرة:</b> {doc.experienceYears} سنة</Typography>
              <Typography><b>سعر الكشف:</b> {fmtMoney(doc.consultationPrice)}</Typography>
              <Typography sx={{ mt: 1, whiteSpace: 'pre-line' }}><b>المؤهلات:</b> {doc.qualifications}</Typography>
            </Section>
          )}
          <Section title="الفروع" sx={{ mt: 2 }}>
            {p.branches.length ? p.branches.map((b) => <Typography key={b.id}>• {b.name} — {b.address} {!b.isActive && '(موقوف)'}</Typography>) : <Typography color="text.secondary">لا توجد فروع</Typography>}
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="مستندات التحقق">
            {p.documents.length ? p.documents.map((d) => (
              <Stack key={d.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
                <Typography sx={{ flex: 1 }}>{PROVIDER_DOC_TYPE[d.type] || d.type}</Typography>
                <ProtectedFile fileId={d.fileId} label="عرض" />
                {d.verifiedAt ? <Chip size="small" color="success" label="تم التحقق" /> : <Button size="small" variant="outlined" onClick={() => verify.mutate(d.id)}>تأكيد المستند</Button>}
              </Stack>
            )) : <Alert severity="warning">لم يرفع مقدم الخدمة أي مستندات بعد.</Alert>}
          </Section>
          {p.type === 'LABORATORY' && <Box sx={{ mt: 2 }}><AdminLabCatalogSection providerId={p.id} /></Box>}
          {p.type === 'RADIOLOGY' && <Box sx={{ mt: 2 }}><AdminRadiologyCatalogSection providerId={p.id} /></Box>}
          <Section title="آخر النشاطات" sx={{ mt: 2 }}>
            {p.activity.map((a) => (
              <Stack key={a.id} direction="row" justifyContent="space-between" sx={{ py: 0.4 }}>
                <Typography variant="body2" dir="ltr">{a.action}</Typography>
                <Typography variant="caption" color="text.secondary">{fmtDateTime(a.createdAt)}</Typography>
              </Stack>
            ))}
          </Section>
        </Grid>
      </Grid>
      <Dialog open={!!pending} onClose={() => setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{pending?.label} — {p.nameAr}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>سيصل السبب لصاحب الحساب في الإشعار.</Typography>
          <TextField label="السبب" multiline minRows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPending(null)}>تراجع</Button>
          <Button variant="contained" color="error" disabled={note.trim().length < 3 || act.isPending} onClick={() => act.mutate({ action: pending.a, note })}>{pending?.label}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
