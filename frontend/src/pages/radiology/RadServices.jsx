import { useEffect, useState } from 'react';
import { Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, InputAdornment, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import SearchIcon from '@mui/icons-material/Search';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { MODALITY } from '../../api/radiology';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import { EmptyState, ErrorState, PageHeader, useConfirm, useDebounced } from '../../components/common';
import { fmtMoney } from '../../utils/format';

const BLANK = { modality: 'XRAY', name: '', description: '', price: '', durationMinutes: 15, preparationInstructions: '', requiresReferral: false, reportTemplate: '', turnaroundHours: 24, isActive: true };

function ServiceDialog({ service, onClose }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!service) return setF(null);
    setF(service === 'new' ? { ...BLANK } : Object.fromEntries(Object.entries({ ...BLANK, ...service }).map(([k, v]) => [k, v ?? ''])));
  }, [service]);
  if (!f) return null;
  const save = async () => {
    try {
      const body = {
        modality: f.modality,
        name: f.name.trim(),
        description: f.description || null,
        price: Number(f.price),
        durationMinutes: Number(f.durationMinutes),
        preparationInstructions: f.preparationInstructions || null,
        requiresReferral: !!f.requiresReferral,
        reportTemplate: f.reportTemplate || null,
        turnaroundHours: f.turnaroundHours === '' ? null : Number(f.turnaroundHours),
        isActive: !!f.isActive,
      };
      if (service === 'new') await api.post('/radiology-center/me/services', body);
      else await api.put(`/radiology-center/me/services/${service.id}`, body);
      enqueueSnackbar('تم حفظ الخدمة', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['radiology'] });
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{service === 'new' ? 'خدمة أشعة جديدة' : `تعديل ${service.name}`}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid xs={12} sm={4}>
            <TextField select label="نوع الجهاز" value={f.modality} onChange={(e) => setF({ ...f, modality: e.target.value })}>
              {Object.entries(MODALITY).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid xs={12} sm={8}><TextField label="اسم الفحص" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Grid>
          <Grid xs={6} sm={3}><TextField label="السعر" required type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">ج.م</InputAdornment> }} /></Grid>
          <Grid xs={6} sm={3}><TextField label="مدة الفحص" required type="number" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">دقيقة</InputAdornment> }} helperText="تحجز الجهاز طوال المدة" /></Grid>
          <Grid xs={6} sm={3}><TextField label="التقرير خلال" type="number" value={f.turnaroundHours} onChange={(e) => setF({ ...f, turnaroundHours: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">ساعة</InputAdornment> }} /></Grid>
          <Grid xs={6} sm={3}><FormControlLabel control={<Switch checked={!!f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="متاح للحجز" /></Grid>
          <Grid xs={12}><FormControlLabel control={<Switch checked={!!f.requiresReferral} onChange={(e) => setF({ ...f, requiresReferral: e.target.checked })} />} label="يتطلب خطاب تحويل من طبيب (المريض يرفعه عند الحجز)" /></Grid>
          <Grid xs={12}><TextField label="تعليمات التحضير للمريض" multiline minRows={2} value={f.preparationInstructions} onChange={(e) => setF({ ...f, preparationInstructions: e.target.value })} placeholder="صيام، مثانة ممتلئة، إزالة المعادن…" /></Grid>
          <Grid xs={12}><TextField label="الوصف" multiline minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Grid>
          <Grid xs={12}><TextField label="قالب التقرير (النتائج الطبيعية الافتراضية)" multiline minRows={4} value={f.reportTemplate} onChange={(e) => setF({ ...f, reportTemplate: e.target.value })} inputProps={{ dir: 'auto' }} helperText="يبدأ منه طبيب الأشعة عند كتابة التقرير ويعدّل ما يلزم" /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" disabled={!f.name.trim() || f.price === '' || !f.durationMinutes} onClick={save}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function RadServices() {
  const { can } = useAuth();
  const canEdit = can('radiology.catalog.manage');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [text, setText] = useState('');
  const [modality, setModality] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const search = useDebounced(text);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['radiology', 'services', search, modality, page],
    queryFn: () => api.get(`/radiology-center/me/services${qs({ search, modality, page, pageSize: 20 })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const del = async (s) => {
    if (!(await confirm({ title: `حذف ${s.name}؟`, body: 'إذا كانت عليها حجوزات سابقة سيتم إيقافها بدلاً من الحذف.', danger: true, confirmText: 'حذف' }))) return;
    try {
      const { data: r } = await api.delete(`/radiology-center/me/services/${s.id}`);
      enqueueSnackbar(r.deactivated ? 'تم الإيقاف (عليها حجوزات سابقة)' : 'تم الحذف', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['radiology'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <>
      <PageHeader title="خدمات الأشعة" subtitle="السعر والمدة هما ما يراه المريض ويُحجز به الجهاز." actions={canEdit && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>خدمة جديدة</Button>} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField size="small" placeholder="ابحث بالاسم" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} sx={{ maxWidth: 360 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
        <TextField size="small" select label="الجهاز" value={modality} onChange={(e) => { setModality(e.target.value); setPage(1); }} sx={{ minWidth: 180 }}>
          <MenuItem value="">الكل</MenuItem>
          {Object.entries(MODALITY).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
        </TextField>
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          total={data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          onRowClick={canEdit ? (s) => setEditing(s) : undefined}
          empty={<EmptyState title="لا توجد خدمات" body="أضف فحوصات الأشعة بأسعارها ومدتها." />}
          columns={[
            { key: 'name', label: 'الفحص', render: (s) => <Box><Typography sx={{ fontWeight: 600 }}>{s.name}</Typography>{s.requiresReferral && <Chip size="small" color="warning" variant="outlined" label="يتطلب تحويل" sx={{ mt: 0.5 }} />}</Box> },
            { key: 'modality', label: 'الجهاز', render: (s) => MODALITY[s.modality] || s.modality },
            { key: 'duration', label: 'المدة', render: (s) => `${s.durationMinutes} دقيقة` },
            { key: 'price', label: 'السعر', render: (s) => fmtMoney(s.price) },
            { key: 'tpl', label: 'قالب تقرير', render: (s) => (s.reportTemplate ? '✓' : '—') },
            { key: 'active', label: 'الحالة', render: (s) => <Chip size="small" variant="outlined" color={s.isActive ? 'success' : 'default'} label={s.isActive ? 'متاح' : 'موقوف'} /> },
            ...(canEdit ? [{ key: 'x', label: '', render: (s) => <IconButton size="small" color="error" aria-label="حذف" onClick={(e) => { e.stopPropagation(); del(s); }}><DeleteOutline fontSize="small" /></IconButton> }] : []),
          ]}
        />
      </Card>
      {editing && <ServiceDialog service={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
