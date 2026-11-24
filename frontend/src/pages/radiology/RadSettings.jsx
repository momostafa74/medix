import { useEffect, useState } from 'react';
import { Alert, Box, Button, Divider, FormControlLabel, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { MODALITY, useMyCenter } from '../../api/radiology';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section } from '../../components/common';
import { HoursEditor } from '../lab/LabSettings';
import { tokens } from '../../theme';

const MAIN = ['XRAY', 'US', 'CT', 'MRI', 'MAMMO', 'DEXA', 'FLUORO', 'ECHO'];

function BranchCard({ branch, canEdit }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [hours, setHours] = useState(branch.openingHours || []);
  const [units, setUnits] = useState({});
  useEffect(() => {
    setHours(branch.openingHours || []);
    setUnits(Object.fromEntries(branch.modalities.map((m) => [m.modality, m.units])));
  }, [branch]);
  const call = async (fn, ok) => {
    try {
      await fn();
      enqueueSnackbar(ok, { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['radiology'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Box>
      <Typography sx={{ fontWeight: 700 }}>{branch.name}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{branch.address}{!branch.isActive && ' • غير نشط'}</Typography>
      <Grid container spacing={3}>
        <Grid xs={12} md={7}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>مواعيد العمل</Typography>
          <HoursEditor value={hours} onChange={setHours} disabled={!canEdit} />
          {canEdit && <Button sx={{ mt: 1 }} variant="outlined" disabled={hours.some((h) => h.close <= h.open)} onClick={() => call(() => api.put(`/radiology-center/me/branches/${branch.id}/hours`, { openingHours: hours }), `تم حفظ مواعيد ${branch.name}`)}>حفظ المواعيد</Button>}
        </Grid>
        <Grid xs={12} md={5}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>الأجهزة في الفرع</Typography>
          <Stack spacing={1}>
            {MAIN.map((m) => (
              <Stack key={m} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2">{MODALITY[m]}</Typography>
                <TextField size="small" type="number" value={units[m] ?? 0} disabled={!canEdit} onChange={(e) => setUnits({ ...units, [m]: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} sx={{ width: 90 }} inputProps={{ min: 0, max: 50, 'aria-label': `عدد أجهزة ${MODALITY[m]}` }} />
              </Stack>
            ))}
          </Stack>
          {canEdit && <Button sx={{ mt: 1 }} variant="outlined" onClick={() => call(() => api.put(`/radiology-center/me/branches/${branch.id}/modalities`, { modalities: Object.entries(units).map(([modality, n]) => ({ modality, units: n })) }), 'تم حفظ الأجهزة')}>حفظ الأجهزة</Button>}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>عدد الأجهزة = عدد الفحوصات المتزامنة الممكنة. 0 يعني أن الفرع لا يقدم هذا النوع.</Typography>
        </Grid>
      </Grid>
    </Box>
  );
}

export default function RadSettings() {
  const { can } = useAuth();
  const canEdit = can('provider.manage.own');
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = useMyCenter();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (data) setF({ slotStepMinutes: data.slotStepMinutes, bookingHorizonDays: data.bookingHorizonDays, requireSeparateApprover: data.requireSeparateApprover, accreditation: data.accreditation || '' });
  }, [data]);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !f) return <ListSkeleton rows={3} height={160} />;
  const save = async () => {
    try {
      await api.patch('/radiology-center/me', { slotStepMinutes: Number(f.slotStepMinutes), bookingHorizonDays: Number(f.bookingHorizonDays), requireSeparateApprover: f.requireSeparateApprover, accreditation: f.accreditation || null });
      enqueueSnackbar('تم حفظ الإعدادات', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['radiology'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <>
      <PageHeader title="إعدادات الحجز" subtitle="مواعيد كل فرع وعدد الأجهزة فيه يحددان المواعيد المتاحة للمرضى — مدة كل فحص تُؤخذ من الخدمة." />
      {data.setupWarnings.includes('NO_DEVICES') && <Alert severity="warning" sx={{ mb: 2 }}>لن تظهر مواعيد للمرضى قبل تحديد مواعيد العمل وعدد الأجهزة في فرع واحد على الأقل.</Alert>}
      <Grid container spacing={2}>
        <Grid xs={12} lg={4}>
          <Section title="قواعد الحجز">
            <Stack spacing={2}>
              <TextField label="الفحوصات تبدأ كل" type="number" value={f.slotStepMinutes} disabled={!canEdit} onChange={(e) => setF({ ...f, slotStepMinutes: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">دقيقة</InputAdornment> }} />
              <TextField label="الحجز متاح حتى" type="number" value={f.bookingHorizonDays} disabled={!canEdit} onChange={(e) => setF({ ...f, bookingHorizonDays: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">يوم</InputAdornment> }} />
              <TextField label="الاعتماد / الترخيص" value={f.accreditation} disabled={!canEdit} onChange={(e) => setF({ ...f, accreditation: e.target.value })} />
              <FormControlLabel control={<Switch checked={f.requireSeparateApprover} disabled={!canEdit} onChange={(e) => setF({ ...f, requireSeparateApprover: e.target.checked })} />} label="يعتمد التقرير طبيب غير الذي كتبه" />
              {canEdit && <Button variant="contained" onClick={save}>حفظ</Button>}
            </Stack>
          </Section>
          <Box sx={{ mt: 2, p: 2, borderRadius: '12px', bgcolor: tokens.mint }}>
            <Typography variant="body2">مثال: رنين 45 دقيقة على جهاز واحد يفتح من 9 ص إلى 10 م = حتى 17 فحص في اليوم، وتظهر المواعيد كل {f.slotStepMinutes} دقيقة بشرط أن يكون الجهاز متاحاً طوال مدة الفحص.</Typography>
          </Box>
        </Grid>
        <Grid xs={12} lg={8}>
          <Section title="الفروع والأجهزة">
            <Stack spacing={3} divider={<Divider flexItem />}>
              {data.branches.map((b) => <BranchCard key={b.id} branch={b} canEdit={canEdit} />)}
            </Stack>
          </Section>
        </Grid>
      </Grid>
    </>
  );
}
