import { useEffect, useState } from 'react';
import { Alert, Box, Button, Divider, FormControlLabel, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { useMyPharmacy } from '../../api/pharmacy';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section } from '../../components/common';
import { HoursEditor } from '../lab/LabSettings';
import { fmtMoney } from '../../utils/format';
import { tokens } from '../../theme';

function BranchHours({ branch, canEdit }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [hours, setHours] = useState(branch.openingHours || []);
  useEffect(() => setHours(branch.openingHours || []), [branch]);
  return (
    <Box>
      <Typography sx={{ fontWeight: 700 }}>{branch.name}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{branch.address}{!branch.isActive && ' • غير نشط'}</Typography>
      <HoursEditor value={hours} onChange={setHours} disabled={!canEdit} />
      {canEdit && (
        <Button sx={{ mt: 1 }} variant="outlined" disabled={hours.some((h) => h.close <= h.open)}
          onClick={async () => {
            try {
              await api.put(`/pharmacy/me/branches/${branch.id}/hours`, { openingHours: hours });
              enqueueSnackbar(`تم حفظ مواعيد ${branch.name}`, { variant: 'success' });
              qc.invalidateQueries({ queryKey: ['pharmacy'] });
            } catch (e) {
              enqueueSnackbar(errorMessage(e), { variant: 'error' });
            }
          }}>
          حفظ المواعيد
        </Button>
      )}
    </Box>
  );
}

const num = (v) => (v === '' || v == null ? null : Number(v));

export default function PhSettings() {
  const { can } = useAuth();
  const canEdit = can('provider.manage.own');
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = useMyPharmacy();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (data) {
      setF({
        deliveryAvailable: data.deliveryAvailable,
        deliveryFee: data.deliveryFee ?? '',
        freeDeliveryOver: data.freeDeliveryOver ?? '',
        minOrderForDelivery: data.minOrderForDelivery ?? 0,
        estimatedDeliveryMinutes: data.estimatedDeliveryMinutes,
        deliveryAreasNote: data.deliveryAreasNote || '',
        is24Hours: data.is24Hours,
      });
    }
  }, [data]);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !f) return <ListSkeleton rows={3} height={160} />;
  const save = async () => {
    try {
      await api.patch('/pharmacy/me', {
        deliveryAvailable: f.deliveryAvailable,
        deliveryFee: num(f.deliveryFee),
        freeDeliveryOver: num(f.freeDeliveryOver),
        minOrderForDelivery: Number(f.minOrderForDelivery) || 0,
        estimatedDeliveryMinutes: Number(f.estimatedDeliveryMinutes) || 60,
        deliveryAreasNote: f.deliveryAreasNote || null,
        is24Hours: f.is24Hours,
      });
      enqueueSnackbar('تم حفظ الإعدادات', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const money = { endAdornment: <InputAdornment position="end">ج.م</InputAdornment> };
  return (
    <>
      <PageHeader title="التوصيل ومواعيد العمل" subtitle="هذه القواعد تُطبَّق تلقائياً على كل طلب: رسوم التوصيل، التوصيل المجاني، والحد الأدنى." />
      {data.setupWarnings.includes('BRANCH_HOURS_MISSING') && <Alert severity="warning" sx={{ mb: 2 }}>حدد مواعيد العمل حتى يظهر للمرضى إن كانت الصيدلية مفتوحة الآن.</Alert>}
      <Grid container spacing={2}>
        <Grid xs={12} lg={5}>
          <Section title="التوصيل">
            <Stack spacing={2}>
              <FormControlLabel control={<Switch checked={f.deliveryAvailable} disabled={!canEdit} onChange={(e) => setF({ ...f, deliveryAvailable: e.target.checked })} />} label="نوفر التوصيل للمنازل" />
              <TextField label="رسوم التوصيل" type="number" value={f.deliveryFee} disabled={!canEdit || !f.deliveryAvailable} onChange={(e) => setF({ ...f, deliveryFee: e.target.value })} InputProps={money} />
              <TextField label="توصيل مجاني للطلبات من" type="number" value={f.freeDeliveryOver} disabled={!canEdit || !f.deliveryAvailable} onChange={(e) => setF({ ...f, freeDeliveryOver: e.target.value })} InputProps={money} helperText="اتركه فارغاً إذا لم يكن هناك توصيل مجاني" />
              <TextField label="أقل قيمة لطلبات التوصيل" type="number" value={f.minOrderForDelivery} disabled={!canEdit || !f.deliveryAvailable} onChange={(e) => setF({ ...f, minOrderForDelivery: e.target.value })} InputProps={money} />
              <TextField label="الوقت المتوقع للتوصيل" type="number" value={f.estimatedDeliveryMinutes} disabled={!canEdit || !f.deliveryAvailable} onChange={(e) => setF({ ...f, estimatedDeliveryMinutes: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">دقيقة</InputAdornment> }} />
              <TextField label="مناطق التوصيل" multiline value={f.deliveryAreasNote} disabled={!canEdit || !f.deliveryAvailable} onChange={(e) => setF({ ...f, deliveryAreasNote: e.target.value })} />
              <Divider />
              <FormControlLabel control={<Switch checked={f.is24Hours} disabled={!canEdit} onChange={(e) => setF({ ...f, is24Hours: e.target.checked })} />} label="الصيدلية تعمل 24 ساعة" />
              {canEdit && <Button variant="contained" onClick={save}>حفظ</Button>}
            </Stack>
          </Section>
          <Box sx={{ mt: 2, p: 2, borderRadius: '12px', bgcolor: tokens.mint }}>
            <Typography variant="body2">
              مثال: طلب بقيمة {fmtMoney(250)} {f.deliveryAvailable ? (num(f.freeDeliveryOver) != null && 250 >= num(f.freeDeliveryOver) ? '— التوصيل مجاني' : `+ توصيل ${fmtMoney(num(f.deliveryFee) || 0)}`) : '— استلام من الفرع فقط'}
              {f.deliveryAvailable && Number(f.minOrderForDelivery) > 250 ? ' (أقل من الحد الأدنى للتوصيل)' : ''}.
            </Typography>
          </Box>
        </Grid>
        <Grid xs={12} lg={7}>
          <Section title="مواعيد عمل الفروع">
            {f.is24Hours && <Alert severity="info" sx={{ mb: 2 }}>الصيدلية مفعّل لها 24 ساعة — تظهر «مفتوحة» دائماً.</Alert>}
            <Stack spacing={3} divider={<Divider flexItem />}>
              {data.branches.map((b) => <BranchHours key={b.id} branch={b} canEdit={canEdit} />)}
            </Stack>
          </Section>
        </Grid>
      </Grid>
    </>
  );
}
