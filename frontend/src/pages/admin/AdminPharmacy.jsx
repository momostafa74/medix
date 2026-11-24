import { useState } from 'react';
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
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { FULFILLMENT, PH_STATUS, medName, usePhOrder, usePhOrders } from '../../api/pharmacy';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { ErrorState, ListSkeleton, PageHeader, Section, useDebounced } from '../../components/common';
import { HistoryList } from '../../components/lab/LabUi';
import { PhStatusChip } from '../../components/pharmacy/PhUi';
import { fmtDateTime, fmtMoney } from '../../utils/format';

function OrderDrawer({ id, onClose }) {
  const { data: o, isLoading, error } = usePhOrder(id);
  return (
    <Drawer anchor="left" open={!!id} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 2 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" dir="ltr">{o?.code}</Typography>
        <IconButton onClick={onClose} aria-label="إغلاق"><CloseIcon /></IconButton>
      </Stack>
      {error && <ErrorState error={error} />}
      {isLoading ? <ListSkeleton rows={3} /> : o && (
        <Stack spacing={2}>
          <Alert severity="info">عرض إداري: بيانات تشغيلية فقط. الأدوية والروشتات بيانات طبية لا تظهر لفريق المنصة.</Alert>
          <Stack direction="row" spacing={1}><PhStatusChip value={o.status} /><Chip size="small" variant="outlined" label={o.paymentStatus === 'PAID' ? 'مدفوع' : 'غير مدفوع'} /></Stack>
          <Typography><b>الصيدلية:</b> {o.pharmacy.nameAr}</Typography>
          <Typography><b>المريض:</b> {o.patient.fullName}</Typography>
          <Typography><b>الاستلام:</b> {FULFILLMENT[o.fulfillment]}</Typography>
          <Typography><b>عدد الأصناف:</b> {o.itemsCount}{o.hasPrescription ? ' • مع روشتة' : ''}</Typography>
          <Typography><b>الإجمالي:</b> {fmtMoney(o.total)} (توصيل {fmtMoney(o.deliveryFee)})</Typography>
          <Typography><b>تاريخ الطلب:</b> {fmtDateTime(o.createdAt)}</Typography>
          {o.cancelReason && <Typography><b>سبب الإلغاء:</b> {o.cancelReason}</Typography>}
          <Section title="السجل"><HistoryList history={o.history} labels={PH_STATUS} /></Section>
        </Stack>
      )}
    </Drawer>
  );
}

const TABS = [
  { key: 'all', label: 'الكل', status: '' },
  { key: 'open', label: 'جارية', status: 'PENDING,CONFIRMED,PREPARING,READY,OUT_FOR_DELIVERY' },
  { key: 'pending', label: 'بانتظار التأكيد', status: 'PENDING' },
  { key: 'done', label: 'تم التسليم', status: 'DELIVERED' },
  { key: 'closed', label: 'ملغاة', status: 'CANCELLED' },
];

export function AdminPharmacyOrders() {
  const [tab, setTab] = useState('all');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const search = useDebounced(text);
  const t = TABS.find((x) => x.key === tab);
  const { data, isLoading, error, refetch } = usePhOrders('admin', { status: t.status, search, page, pageSize: 20 });
  return (
    <>
      <PageHeader title="طلبات الصيدليات" subtitle="متابعة تشغيلية لكل الصيدليات — بدون أسماء الأدوية أو الروشتات." />
      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(1); }} variant="scrollable" allowScrollButtonsMobile>
          {TABS.map((x) => <Tab key={x.key} value={x.key} label={x.label} />)}
        </Tabs>
      </Card>
      <TextField size="small" placeholder="رقم الطلب أو الصيدلية أو المريض" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} sx={{ mb: 2, maxWidth: 420, width: '100%' }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
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
            { key: 'pharmacy', label: 'الصيدلية', render: (o) => o.pharmacy.nameAr },
            { key: 'patientName', label: 'المريض' },
            { key: 'fulfillment', label: 'الاستلام', render: (o) => FULFILLMENT[o.fulfillment] },
            { key: 'createdAt', label: 'التاريخ', render: (o) => fmtDateTime(o.createdAt) },
            { key: 'total', label: 'الإجمالي', render: (o) => fmtMoney(o.total) },
            { key: 'status', label: 'الحالة', render: (o) => <PhStatusChip value={o.status} /> },
          ]}
        />
      </Card>
      <OrderDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

const EMPTY = { nameEn: '', nameAr: '', genericName: '', strength: '', form: '', manufacturer: '', category: '', barcode: '', kind: 'MEDICINE', requiresPrescription: false, isActive: true };

function MedicineDialog({ value, onClose, onDone }) {
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.entries(value || {}).map(([k, v]) => [k, v ?? ''])) }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { ...f };
    ['nameAr', 'genericName', 'strength', 'form', 'manufacturer', 'category', 'barcode'].forEach((k) => (body[k] = body[k] || null));
    delete body.id;
    ['offers', 'minPrice', 'maxPrice', 'addedBy', 'pharmacies', 'ordered', 'createdAt'].forEach((k) => delete body[k]);
    try {
      if (value?.id) await api.patch(`/admin/medicines/${value.id}`, body);
      else await api.post('/admin/medicines', body);
      enqueueSnackbar('تم الحفظ', { variant: 'success' });
      onDone();
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{value?.id ? 'تعديل صنف' : 'إضافة صنف للدليل'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          <Grid xs={12} sm={6}><TextField fullWidth required label="الاسم التجاري (EN)" value={f.nameEn} onChange={set('nameEn')} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12} sm={6}><TextField fullWidth label="الاسم بالعربي" value={f.nameAr} onChange={set('nameAr')} /></Grid>
          <Grid xs={12} sm={6}><TextField fullWidth label="المادة الفعالة" value={f.genericName} onChange={set('genericName')} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={6} sm={3}><TextField fullWidth label="التركيز" value={f.strength} onChange={set('strength')} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={6} sm={3}><TextField fullWidth label="الشكل" value={f.form} onChange={set('form')} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12} sm={6}><TextField fullWidth label="الشركة المصنعة" value={f.manufacturer} onChange={set('manufacturer')} /></Grid>
          <Grid xs={12} sm={6}><TextField fullWidth label="القسم" value={f.category} onChange={set('category')} /></Grid>
          <Grid xs={6}><TextField fullWidth select label="النوع" value={f.kind} onChange={set('kind')}><MenuItem value="MEDICINE">دواء</MenuItem><MenuItem value="PRODUCT">منتج</MenuItem></TextField></Grid>
          <Grid xs={6}><TextField fullWidth label="الباركود" value={f.barcode} onChange={set('barcode')} inputProps={{ dir: 'ltr' }} /></Grid>
          <Grid xs={12}>
            <FormControlLabel control={<Switch checked={!!f.requiresPrescription} onChange={(e) => setF({ ...f, requiresPrescription: e.target.checked })} />} label="يُصرف بروشتة فقط" />
            <FormControlLabel control={<Switch checked={!!f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="نشط (يظهر في البحث)" />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" disabled={f.nameEn.trim().length < 2} onClick={save}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

export function AdminMedicines() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [text, setText] = useState('');
  const [kind, setKind] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);
  const search = useDebounced(text);
  const params = { search, kind, page, pageSize: 25, ...(filter === 'pharmacy' ? { pharmacyAdded: true } : filter === 'inactive' ? { isActive: false } : filter === 'rx' ? { requiresPrescription: true } : {}) };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin', 'medicines', params], queryFn: () => api.get(`/admin/medicines${qs(params)}`).then((r) => r.data), placeholderData: keepPreviousData });
  const toggle = async (m) => {
    try {
      await api.patch(`/admin/medicines/${m.id}`, { isActive: !m.isActive });
      qc.invalidateQueries({ queryKey: ['admin', 'medicines'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const manage = can('medicines.manage');
  return (
    <>
      <PageHeader title="دليل الأدوية" subtitle="الدليل المشترك الذي تبحث فيه المرضى والأطباء والصيدليات. الأصناف المضافة من الصيدليات تظهر للمراجعة." actions={manage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEdit({})}>إضافة صنف</Button>} />
      <Card sx={{ mb: 2 }}>
        <Tabs value={filter} onChange={(_, v) => { setFilter(v); setPage(1); }} variant="scrollable">
          <Tab value="" label="الكل" />
          <Tab value="pharmacy" label="مضاف من الصيدليات" />
          <Tab value="rx" label="بروشتة" />
          <Tab value="inactive" label="موقوف" />
        </Tabs>
      </Card>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField size="small" fullWidth placeholder="الاسم أو المادة الفعالة أو الباركود" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
        <TextField size="small" select label="النوع" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">الكل</MenuItem>
          <MenuItem value="MEDICINE">أدوية</MenuItem>
          <MenuItem value="PRODUCT">منتجات</MenuItem>
        </TextField>
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={25}
          onPageChange={setPage}
          columns={[
            { key: 'name', label: 'الصنف', render: (m) => <Box><Typography sx={{ fontWeight: 600 }} dir="ltr" textAlign="right">{medName(m)}</Typography><Typography variant="caption" color="text.secondary">{[m.nameAr, m.genericName, m.manufacturer].filter(Boolean).join(' • ')}</Typography></Box> },
            { key: 'cat', label: 'القسم', render: (m) => <Stack direction="row" spacing={0.5}>{m.category && <Chip size="small" variant="outlined" label={m.category} />}{m.requiresPrescription && <Chip size="small" color="warning" variant="outlined" label="روشتة" />}</Stack> },
            { key: 'addedBy', label: 'المصدر', render: (m) => m.addedBy || 'المنصة' },
            { key: 'pharmacies', label: 'صيدليات', render: (m) => m.pharmacies },
            { key: 'ordered', label: 'مرات الطلب', render: (m) => m.ordered },
            { key: 'active', label: 'نشط', render: (m) => <Switch size="small" checked={m.isActive} disabled={!manage} onChange={() => toggle(m)} inputProps={{ 'aria-label': 'نشط' }} /> },
            { key: 'act', label: '', render: (m) => manage && <IconButton size="small" aria-label="تعديل" onClick={() => setEdit(m)}><EditOutlined fontSize="small" /></IconButton> },
          ]}
        />
      </Card>
      {edit && <MedicineDialog value={edit.id ? edit : null} onClose={() => setEdit(null)} onDone={() => qc.invalidateQueries({ queryKey: ['admin', 'medicines'] })} />}
    </>
  );
}
