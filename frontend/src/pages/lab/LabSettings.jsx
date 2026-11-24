import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, Checkbox, Divider, FormControlLabel, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { fromHHmm, toHHmm, useMyLab } from '../../api/labs';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section } from '../../components/common';
import { DAYS } from '../../utils/format';
import { tokens } from '../../theme';

const WEEK = [6, 0, 1, 2, 3, 4, 5]; // Saturday first, as Egyptian businesses read their week

/** One opening block per day (enough for labs; the API accepts several). */
export function HoursEditor({ value, onChange, disabled }) {
  const byDay = Object.fromEntries((value || []).map((h) => [h.day, h]));
  const set = (day, patch) => {
    const cur = byDay[day] || { day, open: 480, close: 1260 };
    const next = { ...cur, ...patch };
    const rest = (value || []).filter((h) => h.day !== day);
    onChange(patch.off ? rest : [...rest, { day, open: next.open, close: next.close }].sort((a, b) => a.day - b.day));
  };
  const copyToAll = () => {
    const first = WEEK.map((d) => byDay[d]).find(Boolean);
    if (first) onChange(WEEK.filter((d) => d !== 5 || byDay[5]).map((day) => ({ day, open: first.open, close: first.close })));
  };
  return (
    <Stack spacing={1}>
      {WEEK.map((d) => {
        const h = byDay[d];
        return (
          <Stack key={d} direction="row" spacing={1.5} alignItems="center" sx={{ opacity: h ? 1 : 0.6 }}>
            <FormControlLabel sx={{ width: 120, m: 0 }} control={<Checkbox size="small" checked={!!h} disabled={disabled} onChange={(e) => set(d, e.target.checked ? {} : { off: true })} />} label={DAYS[d]} />
            {h ? (
              <>
                <TextField size="small" type="time" label="من" value={toHHmm(h.open)} disabled={disabled} onChange={(e) => set(d, { open: fromHHmm(e.target.value) })} InputLabelProps={{ shrink: true }} sx={{ width: 150 }} />
                <TextField size="small" type="time" label="إلى" value={toHHmm(h.close === 1440 ? 1439 : h.close)} disabled={disabled} onChange={(e) => set(d, { close: fromHHmm(e.target.value) })} InputLabelProps={{ shrink: true }} sx={{ width: 150 }} error={h.close <= h.open} />
              </>
            ) : (
              <Typography color="text.secondary">مغلق</Typography>
            )}
          </Stack>
        );
      })}
      {!disabled && <Box><Button size="small" onClick={copyToAll}>تطبيق مواعيد أول يوم على باقي الأيام</Button></Box>}
    </Stack>
  );
}

function BranchHours({ branch, canEdit }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [hours, setHours] = useState(branch.openingHours || []);
  useEffect(() => setHours(branch.openingHours || []), [branch]);
  const save = async () => {
    try {
      await api.put(`/labs/me/branches/${branch.id}/hours`, { openingHours: hours });
      enqueueSnackbar(`تم حفظ مواعيد ${branch.name}`, { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['lab'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Box>
      <Typography sx={{ fontWeight: 700 }}>{branch.name}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{branch.address}{!branch.isActive && ' • الفرع غير نشط'}</Typography>
      <HoursEditor value={hours} onChange={setHours} disabled={!canEdit} />
      {canEdit && <Button sx={{ mt: 1 }} variant="outlined" onClick={save} disabled={hours.some((h) => h.close <= h.open)}>حفظ مواعيد الفرع</Button>}
    </Box>
  );
}

export default function LabSettings() {
  const { can } = useAuth();
  const canEdit = can('provider.manage.own');
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = useMyLab();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (data)
      setF({
        homeCollection: data.homeCollection,
        homeCollectionFee: data.homeCollectionFee ?? 0,
        accreditation: data.accreditation || '',
        slotMinutes: data.slotMinutes,
        slotCapacity: data.slotCapacity,
        homeSlotCapacity: data.homeSlotCapacity,
        bookingHorizonDays: data.bookingHorizonDays,
        requireSeparateApprover: data.requireSeparateApprover,
        homeCollectionHours: data.homeCollectionHours || [],
      });
  }, [data]);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !f) return <ListSkeleton rows={3} height={160} />;
  const save = async () => {
    try {
      await api.patch('/labs/me', {
        ...f,
        homeCollectionFee: Number(f.homeCollectionFee) || 0,
        accreditation: f.accreditation || null,
        slotMinutes: Number(f.slotMinutes),
        slotCapacity: Number(f.slotCapacity),
        homeSlotCapacity: Number(f.homeSlotCapacity),
        bookingHorizonDays: Number(f.bookingHorizonDays),
      });
      enqueueSnackbar('تم حفظ الإعدادات', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['lab'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <>
      <PageHeader title="إعدادات الحجز" subtitle="مواعيد الفروع وسعة كل موعد والسحب المنزلي — هي ما يحدد المواعيد المتاحة للمرضى." />
      {data.setupWarnings.includes('BRANCH_HOURS_MISSING') && <Alert severity="warning" sx={{ mb: 2 }}>لن يظهر حجز الفروع للمرضى حتى تحدد مواعيد العمل لفرع واحد على الأقل.</Alert>}
      <Grid container spacing={2}>
        <Grid xs={12} lg={6}>
          <Stack spacing={2}>
            <Section title="قواعد الحجز">
              <Grid container spacing={2}>
                <Grid xs={6}><TextField label="مدة الموعد بالفرع" type="number" value={f.slotMinutes} disabled={!canEdit} onChange={(e) => setF({ ...f, slotMinutes: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">دقيقة</InputAdornment> }} /></Grid>
                <Grid xs={6}><TextField label="عدد المرضى في نفس الموعد" type="number" value={f.slotCapacity} disabled={!canEdit} onChange={(e) => setF({ ...f, slotCapacity: e.target.value })} /></Grid>
                <Grid xs={6}><TextField label="الحجز متاح حتى" type="number" value={f.bookingHorizonDays} disabled={!canEdit} onChange={(e) => setF({ ...f, bookingHorizonDays: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">يوم</InputAdornment> }} /></Grid>
                <Grid xs={6}><TextField label="الاعتماد / الشهادة" value={f.accreditation} disabled={!canEdit} onChange={(e) => setF({ ...f, accreditation: e.target.value })} placeholder="ISO 15189" /></Grid>
                <Grid xs={12}>
                  <FormControlLabel control={<Switch checked={f.requireSeparateApprover} disabled={!canEdit} onChange={(e) => setF({ ...f, requireSeparateApprover: e.target.checked })} />} label="الاعتماد يتطلب شخصاً غير الذي أدخل النتيجة (مبدأ الأربع عيون)" />
                </Grid>
              </Grid>
            </Section>
            <Section title="السحب المنزلي" action={<Switch checked={f.homeCollection} disabled={!canEdit} onChange={(e) => setF({ ...f, homeCollection: e.target.checked })} inputProps={{ 'aria-label': 'تفعيل السحب المنزلي' }} />}>
              {f.homeCollection ? (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2}>
                    <TextField label="رسوم الزيارة" type="number" value={f.homeCollectionFee} disabled={!canEdit} onChange={(e) => setF({ ...f, homeCollectionFee: e.target.value })} InputProps={{ endAdornment: <InputAdornment position="end">ج.م</InputAdornment> }} />
                    <TextField label="زيارات في نفس الساعة" type="number" value={f.homeSlotCapacity} disabled={!canEdit} onChange={(e) => setF({ ...f, homeSlotCapacity: e.target.value })} />
                  </Stack>
                  <Typography sx={{ fontWeight: 600 }}>مواعيد فريق السحب</Typography>
                  <HoursEditor value={f.homeCollectionHours} onChange={(v) => setF({ ...f, homeCollectionHours: v })} disabled={!canEdit} />
                </Stack>
              ) : (
                <Typography color="text.secondary">فعّل الخدمة ليتمكن المرضى من حجز سحب العينة من المنزل.</Typography>
              )}
            </Section>
            {canEdit && <Button variant="contained" size="large" onClick={save}>حفظ الإعدادات</Button>}
          </Stack>
        </Grid>
        <Grid xs={12} lg={6}>
          <Section title="مواعيد عمل الفروع">
            <Stack spacing={2.5} divider={<Divider flexItem />}>
              {data.branches.map((b) => <BranchHours key={b.id} branch={b} canEdit={canEdit} />)}
            </Stack>
            {!data.branches.length && <Typography color="text.secondary">أضف فرعاً من صفحة «الملف والفروع».</Typography>}
          </Section>
          <Card sx={{ p: 2, mt: 2, bgcolor: tokens.mint, borderColor: tokens.mint }}>
            <Typography variant="body2">
              المواعيد تُقسَّم تلقائياً حسب مدة الموعد. مثال: من 8 صباحاً إلى 10 مساءً بمدة {f.slotMinutes} دقيقة وسعة {f.slotCapacity} = {Math.floor((14 * 60) / (Number(f.slotMinutes) || 30)) * (Number(f.slotCapacity) || 1)} حجز في اليوم للفرع.
            </Typography>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
