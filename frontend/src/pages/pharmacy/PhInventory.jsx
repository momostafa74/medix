import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorCode, errorMessage } from '../../api/client';
import { medName, useInventory } from '../../api/pharmacy';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { ErrorState, PageHeader, useConfirm, useDebounced } from '../../components/common';
import { MedicineAutocomplete } from '../../components/pharmacy/PhUi';
import { fmtMoney, fmtRelative } from '../../utils/format';
import { tokens } from '../../theme';

const STOCK_TABS = [
  { key: '', label: 'كل الأصناف' },
  { key: 'in', label: 'متوفر' },
  { key: 'low', label: 'منخفض (5 أو أقل)' },
  { key: 'out', label: 'نفد' },
];

function AddDialog({ open, onClose, onDone }) {
  const { enqueueSnackbar } = useSnackbar();
  const [mode, setMode] = useState('catalog');
  const [med, setMed] = useState(null);
  const [f, setF] = useState({ price: '', quantity: '', nameEn: '', nameAr: '', genericName: '', strength: '', form: '', category: '', kind: 'MEDICINE', requiresPrescription: false });
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setMed(null);
    setF({ price: '', quantity: '', nameEn: '', nameAr: '', genericName: '', strength: '', form: '', category: '', kind: 'MEDICINE', requiresPrescription: false });
  };
  const submit = async () => {
    setBusy(true);
    const qty = f.quantity === '' ? null : Number(f.quantity);
    try {
      if (mode === 'catalog') await api.post('/pharmacy/me/inventory', { medicineId: med.id, price: Number(f.price), quantity: qty });
      else {
        const res = await api.post('/pharmacy/me/inventory/new-medicine', {
          nameEn: f.nameEn, nameAr: f.nameAr || undefined, genericName: f.genericName || undefined, strength: f.strength || undefined, form: f.form || undefined,
          category: f.category || undefined, kind: f.kind, requiresPrescription: f.requiresPrescription, price: Number(f.price), quantity: qty,
        });
        if (!res.data.createdMedicine) enqueueSnackbar('الصنف موجود في الدليل بالفعل — تمت إضافته لقائمتك بدون تكرار', { variant: 'info' });
      }
      enqueueSnackbar('تمت الإضافة', { variant: 'success' });
      reset();
      onDone();
    } catch (e) {
      enqueueSnackbar(errorCode(e) === 'ALREADY_LISTED' ? 'الصنف موجود بالفعل في قائمتك — عدّل سعره من الجدول' : errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const ok = Number(f.price) >= 0 && f.price !== '' && (mode === 'catalog' ? !!med : f.nameEn.trim().length >= 2);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>إضافة صنف</DialogTitle>
      <DialogContent>
        <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ mb: 2 }}>
          <Tab value="catalog" label="من دليل الأدوية" />
          <Tab value="new" label="صنف غير موجود" />
        </Tabs>
        <Stack spacing={2}>
          {mode === 'catalog' ? (
            <MedicineAutocomplete value={med} onChange={setMed} label="ابحث في دليل الأدوية والمنتجات" autoFocus />
          ) : (
            <Grid container spacing={1.5}>
              <Grid xs={12} sm={6}><TextField fullWidth required label="الاسم التجاري (إنجليزي)" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} inputProps={{ dir: 'ltr' }} /></Grid>
              <Grid xs={12} sm={6}><TextField fullWidth label="الاسم بالعربي" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Grid>
              <Grid xs={12} sm={6}><TextField fullWidth label="المادة الفعالة" value={f.genericName} onChange={(e) => setF({ ...f, genericName: e.target.value })} inputProps={{ dir: 'ltr' }} /></Grid>
              <Grid xs={6} sm={3}><TextField fullWidth label="التركيز" value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} inputProps={{ dir: 'ltr' }} /></Grid>
              <Grid xs={6} sm={3}><TextField fullWidth label="الشكل" placeholder="Tablets" value={f.form} onChange={(e) => setF({ ...f, form: e.target.value })} inputProps={{ dir: 'ltr' }} /></Grid>
              <Grid xs={6}><TextField fullWidth select label="النوع" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><MenuItem value="MEDICINE">دواء</MenuItem><MenuItem value="PRODUCT">منتج</MenuItem></TextField></Grid>
              <Grid xs={6}><TextField fullWidth label="القسم" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Grid>
              <Grid xs={12}><FormControlLabel control={<Switch checked={f.requiresPrescription} onChange={(e) => setF({ ...f, requiresPrescription: e.target.checked })} />} label="يُصرف بروشتة فقط" /></Grid>
              <Grid xs={12}><Typography variant="caption" color="text.secondary">الصنف يُضاف لدليل المنصة المشترك (تراجعه الإدارة)، وإذا كان موجوداً بنفس الاسم والتركيز والشكل يُستخدم الموجود.</Typography></Grid>
            </Grid>
          )}
          <Stack direction="row" spacing={1.5}>
            <TextField fullWidth required type="number" label="سعر البيع" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">ج.م</InputAdornment> }} />
            <TextField fullWidth type="number" label="الكمية بالمخزون" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} helperText="اتركها فارغة لعدم التتبع" />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إغلاق</Button>
        <Button variant="contained" disabled={!ok || busy} onClick={submit}>إضافة</Button>
      </DialogActions>
    </Dialog>
  );
}

function EditDialog({ item, onClose, onDone, canPrice }) {
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState(() => ({ price: item?.price ?? '', quantity: item?.quantity ?? '', inStock: item?.inStock ?? true }));
  if (!item) return null;
  const save = async () => {
    try {
      await api.patch(`/pharmacy/me/inventory/${item.id}`, {
        ...(canPrice ? { price: Number(f.price) } : {}),
        quantity: f.quantity === '' ? null : Number(f.quantity),
        inStock: f.inStock,
      });
      enqueueSnackbar('تم الحفظ', { variant: 'success' });
      onDone();
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle dir="ltr" sx={{ textAlign: 'right' }}>{medName(item.medicine)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField type="number" label="السعر" value={f.price} disabled={!canPrice} onChange={(e) => setF({ ...f, price: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">ج.م</InputAdornment> }} helperText={!canPrice ? 'تعديل الأسعار لمدير الصيدلية' : undefined} />
          <TextField type="number" label="الكمية بالمخزون" value={f.quantity ?? ''} onChange={(e) => setF({ ...f, quantity: e.target.value, inStock: e.target.value === '' ? f.inStock : Number(e.target.value) > 0 })} helperText="فارغة = بدون تتبع للكمية" />
          <FormControlLabel control={<Switch checked={f.inStock} onChange={(e) => setF({ ...f, inStock: e.target.checked })} />} label="متاح للطلب" />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={save}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function PhInventory() {
  const { can } = useAuth();
  const manage = can('pharmacy.catalog.manage');
  const [params, setParams] = useSearchParams();
  const stock = params.get('stock') || '';
  const [text, setText] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState(null);
  const search = useDebounced(text);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = useInventory({ search, kind, stock, page, pageSize: 25 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['pharmacy'] });
  const remove = async (i) => {
    if (!(await confirm({ title: 'حذف الصنف من قائمتك؟', body: medName(i.medicine), danger: true, confirmText: 'حذف' }))) return;
    try {
      await api.delete(`/pharmacy/me/inventory/${i.id}`);
      refresh();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <>
      <PageHeader title="الأدوية والمخزون" subtitle="الأسعار والكميات هنا هي ما يراه المرضى عند البحث والمقارنة — والطلبات تخصم من المخزون تلقائياً عند التأكيد." actions={manage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdd(true)}>إضافة صنف</Button>} />
      <Card sx={{ mb: 2 }}>
        <Tabs value={stock} onChange={(_, v) => { setParams(v ? { stock: v } : {}); setPage(1); }} variant="scrollable">
          {STOCK_TABS.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
        </Tabs>
      </Card>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField size="small" fullWidth placeholder="ابحث بالاسم أو المادة الفعالة أو الباركود" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
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
            { key: 'name', label: 'الصنف', render: (i) => <Box><Typography sx={{ fontWeight: 600 }} dir="ltr" textAlign="right">{medName(i.medicine)}</Typography><Typography variant="caption" color="text.secondary">{[i.medicine.nameAr, i.medicine.genericName].filter(Boolean).join(' • ')}</Typography></Box> },
            { key: 'cat', label: 'القسم', render: (i) => <Stack direction="row" spacing={0.5}>{i.medicine.category && <Chip size="small" variant="outlined" label={i.medicine.category} />}{i.medicine.requiresPrescription && <Chip size="small" color="warning" variant="outlined" label="روشتة" />}</Stack> },
            { key: 'price', label: 'السعر', render: (i) => <b>{fmtMoney(i.price)}</b> },
            { key: 'qty', label: 'المخزون', render: (i) => <Typography sx={{ fontWeight: 600, color: !i.inStock ? tokens.signal : i.lowStock ? tokens.saffron : 'inherit' }}>{!i.inStock ? 'نفد' : i.quantity == null ? 'متوفر' : i.quantity}</Typography> },
            { key: 'upd', label: 'آخر تحديث', render: (i) => <Typography variant="caption" color="text.secondary">{fmtRelative(i.updatedAt)}</Typography> },
            {
              key: 'act',
              label: '',
              render: (i) => (
                <Stack direction="row">
                  <IconButton size="small" aria-label="تعديل" onClick={() => setEdit(i)}><EditOutlined fontSize="small" /></IconButton>
                  {manage && <IconButton size="small" aria-label="حذف" onClick={() => remove(i)}><DeleteOutline fontSize="small" /></IconButton>}
                </Stack>
              ),
            },
          ]}
        />
      </Card>
      <AddDialog open={add} onClose={() => setAdd(false)} onDone={refresh} />
      {edit && <EditDialog key={edit.id} item={edit} canPrice={manage} onClose={() => setEdit(null)} onDone={refresh} />}
    </>
  );
}
