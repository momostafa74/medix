import { useState } from 'react';
import { Alert, Box, Card, Chip, Drawer, IconButton, InputAdornment, Stack, Switch, Tab, Tabs, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { useLabOrder, useLabOrders } from '../../api/labs';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { ErrorState, ListSkeleton, PageHeader, Section, useDebounced } from '../../components/common';
import { HistoryList, ItemsSummary, LabStatusChip } from '../../components/lab/LabUi';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import { BOARD_TABS } from '../lab/LabOrdersBoard';
import { MODALITY, RAD_STATUS, useRadOrder, useRadOrders } from '../../api/radiology';
import { RadStatusChip } from '../../components/radiology/RadUi';

function OrderDrawer({ id, onClose }) {
  const { data: o, isLoading, error } = useLabOrder(id);
  return (
    <Drawer anchor="left" open={!!id} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 2 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" dir="ltr">{o?.code}</Typography>
        <IconButton onClick={onClose} aria-label="إغلاق"><CloseIcon /></IconButton>
      </Stack>
      {error && <ErrorState error={error} />}
      {isLoading ? <ListSkeleton rows={3} /> : o && (
        <Stack spacing={2}>
          <Alert severity="info">عرض إداري: بيانات تشغيلية فقط. نتائج التحاليل بيانات طبية لا تظهر لفريق المنصة.</Alert>
          <Stack direction="row" spacing={1}><LabStatusChip value={o.status} /><Chip size="small" variant="outlined" label={o.paymentStatus === 'PAID' ? 'مدفوع' : 'غير مدفوع'} /></Stack>
          <Typography><b>المعمل:</b> {o.laboratory.nameAr}</Typography>
          <Typography><b>المريض:</b> {o.patient.fullName}</Typography>
          <Typography><b>الموعد:</b> {fmtDateTime(o.scheduledAt)} — {o.homeCollection ? 'سحب منزلي' : o.branch?.name}</Typography>
          <Typography><b>الإجمالي:</b> {fmtMoney(o.total)}</Typography>
          <Section title="التحاليل"><ItemsSummary items={o.items} /></Section>
          <Section title="السجل"><HistoryList history={o.history} /></Section>
        </Stack>
      )}
    </Drawer>
  );
}

export function AdminLabOrders() {
  const [tab, setTab] = useState('all');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const search = useDebounced(text);
  const t = BOARD_TABS.find((x) => x.key === tab);
  const { data, isLoading, error, refetch } = useLabOrders('admin', { status: t.status, search, page, pageSize: 20 });
  return (
    <>
      <PageHeader title="طلبات التحاليل" subtitle="متابعة تشغيلية لكل المعامل — بدون نتائج طبية." />
      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(1); }} variant="scrollable" allowScrollButtonsMobile>
          {[...BOARD_TABS.filter((x) => x.key === 'all'), ...BOARD_TABS.filter((x) => x.key !== 'all')].map((x) => <Tab key={x.key} value={x.key} label={x.label} />)}
        </Tabs>
      </Card>
      <TextField size="small" placeholder="كود الطلب أو اسم المريض أو الهاتف" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} sx={{ mb: 2, maxWidth: 420 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          onRowClick={(o) => setOpen(o.id)}
          columns={[
            { key: 'code', label: 'الطلب', render: (o) => <span dir="ltr">{o.code}</span> },
            { key: 'lab', label: 'المعمل', render: (o) => o.laboratory.nameAr },
            { key: 'patientName', label: 'المريض' },
            { key: 'when', label: 'الموعد', render: (o) => fmtDateTime(o.scheduledAt) },
            { key: 'where', label: 'المكان', render: (o) => (o.homeCollection ? <Chip size="small" icon={<HomeOutlined />} label="منزلي" /> : o.branchName) },
            { key: 'total', label: 'المبلغ', render: (o) => fmtMoney(o.total) },
            { key: 'status', label: 'الحالة', render: (o) => <LabStatusChip value={o.status} /> },
          ]}
        />
      </Card>
      <OrderDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Lab catalog on the admin provider page, with platform-level package visibility. */
export function AdminLabCatalogSection({ providerId }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error } = useQuery({ queryKey: ['admin', 'lab-catalog', providerId], queryFn: () => api.get(`/admin/labs/${providerId}/catalog`).then((r) => r.data) });
  if (error) return <ErrorState error={error} />;
  if (isLoading) return <ListSkeleton rows={2} />;
  const toggle = async (p) => {
    try {
      await api.patch(`/admin/lab-packages/${p.id}/visibility`, { isVisible: !p.isVisible });
      qc.invalidateQueries({ queryKey: ['admin', 'lab-catalog', providerId] });
      enqueueSnackbar(p.isVisible ? 'تم إخفاء الباقة من الصفحة العامة' : 'أصبحت الباقة ظاهرة', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Section title={`كتالوج المعمل (${data.tests.length} تحليل • ${data.packages.length} باقة)`}>
      <Stack spacing={0.5} sx={{ mb: 2, maxHeight: 220, overflow: 'auto' }}>
        {data.tests.map((t) => (
          <Stack key={t.id} direction="row" justifyContent="space-between">
            <Typography variant="body2">{t.name} <span dir="ltr" style={{ color: '#4A5F66' }}>{t.code}</span>{!t.isActive && ' (موقوف)'}</Typography>
            <Typography variant="body2">{fmtMoney(t.price)}</Typography>
          </Stack>
        ))}
      </Stack>
      {data.packages.map((p) => (
        <Stack key={p.id} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.5 }}>
          <Box>
            <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
            <Typography variant="caption" color="text.secondary">{fmtMoney(p.price)} • {p.tests.length} تحاليل</Typography>
          </Box>
          {can('providers.manage.any') && <Switch checked={p.isVisible} onChange={() => toggle(p)} inputProps={{ 'aria-label': `إظهار ${p.name}` }} />}
        </Stack>
      ))}
    </Section>
  );
}

// ───────────── Radiology (same oversight model: metadata only) ─────────────

function RadDrawer({ id, onClose }) {
  const { data: o, isLoading, error } = useRadOrder(id);
  return (
    <Drawer anchor="left" open={!!id} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 2 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" dir="ltr">{o?.code}</Typography>
        <IconButton onClick={onClose} aria-label="إغلاق"><CloseIcon /></IconButton>
      </Stack>
      {error && <ErrorState error={error} />}
      {isLoading ? <ListSkeleton rows={3} /> : o && (
        <Stack spacing={2}>
          <Alert severity="info">عرض إداري: بيانات تشغيلية فقط. تقارير الأشعة وصورها بيانات طبية لا تظهر لفريق المنصة.</Alert>
          <Stack direction="row" spacing={1}><RadStatusChip value={o.status} /><Chip size="small" variant="outlined" label={o.paymentStatus === 'PAID' ? 'مدفوع' : 'غير مدفوع'} /></Stack>
          <Typography><b>المركز:</b> {o.center.nameAr} — {o.branch?.name}</Typography>
          <Typography><b>الفحص:</b> {o.service.name}</Typography>
          <Typography><b>المريض:</b> {o.patient.fullName}</Typography>
          <Typography><b>الموعد:</b> {fmtDateTime(o.scheduledAt)}</Typography>
          <Typography><b>السعر:</b> {fmtMoney(o.price)}</Typography>
          <Section title="السجل"><HistoryList history={o.history} labels={RAD_STATUS} /></Section>
        </Stack>
      )}
    </Drawer>
  );
}

const RAD_ADMIN_TABS = [
  { key: 'all', label: 'الكل', status: '' },
  { key: 'open', label: 'قادمة', status: 'BOOKED,CHECKED_IN,EXAMINATION' },
  { key: 'reporting', label: 'تقارير', status: 'REPORTING' },
  { key: 'done', label: 'مكتملة', status: 'APPROVED,DELIVERED' },
  { key: 'closed', label: 'ملغاة / لم يحضر', status: 'CANCELLED,NO_SHOW' },
];

export function AdminRadiologyOrders() {
  const [tab, setTab] = useState('all');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const search = useDebounced(text);
  const t = RAD_ADMIN_TABS.find((x) => x.key === tab);
  const { data, isLoading, error, refetch } = useRadOrders('admin', { status: t.status, search, page, pageSize: 20 });
  return (
    <>
      <PageHeader title="حجوزات الأشعة" subtitle="متابعة تشغيلية لكل المراكز — بدون تقارير أو صور طبية." />
      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(1); }} variant="scrollable" allowScrollButtonsMobile>
          {RAD_ADMIN_TABS.map((x) => <Tab key={x.key} value={x.key} label={x.label} />)}
        </Tabs>
      </Card>
      <TextField size="small" placeholder="كود الحجز أو اسم المريض أو الهاتف" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} sx={{ mb: 2, maxWidth: 420 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          onRowClick={(o) => setOpen(o.id)}
          columns={[
            { key: 'code', label: 'الحجز', render: (o) => <span dir="ltr">{o.code}</span> },
            { key: 'center', label: 'المركز', render: (o) => o.center.nameAr },
            { key: 'serviceName', label: 'الفحص' },
            { key: 'patientName', label: 'المريض' },
            { key: 'when', label: 'الموعد', render: (o) => fmtDateTime(o.scheduledAt) },
            { key: 'price', label: 'السعر', render: (o) => fmtMoney(o.price) },
            { key: 'status', label: 'الحالة', render: (o) => <RadStatusChip value={o.status} /> },
          ]}
        />
      </Card>
      <RadDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

export function AdminRadiologyCatalogSection({ providerId }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin', 'rad-catalog', providerId], queryFn: () => api.get(`/admin/radiology/${providerId}/catalog`).then((r) => r.data) });
  if (error) return <ErrorState error={error} />;
  if (isLoading) return <ListSkeleton rows={2} />;
  return (
    <Section title={`خدمات المركز (${data.services.length}) • ${data.units.reduce((n, u) => n + u.units, 0)} جهاز`}>
      <Stack spacing={0.5} sx={{ maxHeight: 240, overflow: 'auto' }}>
        {data.services.map((s) => (
          <Stack key={s.id} direction="row" justifyContent="space-between">
            <Typography variant="body2">{s.name} <span style={{ color: '#4A5F66' }}>({MODALITY[s.modality] || s.modality}){!s.isActive && ' — موقوف'}</span></Typography>
            <Typography variant="body2">{fmtMoney(s.price)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}
