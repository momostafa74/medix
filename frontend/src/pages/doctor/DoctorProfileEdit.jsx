import { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { Box, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { useSpecialties } from '../../api/queries';
import { ErrorState, ListSkeleton, PageHeader, Section } from '../../components/common';
import { BranchesManager, DocumentsManager, ProviderInfoForm, ServicesManager, useMyProvider } from '../../components/ProviderManagement';
import { LANGUAGES } from '../../utils/labels';

export default function DoctorProfileEdit() {
  const { data: provider, isLoading: pl, error } = useMyProvider();
  const { data: doc, isLoading: dl } = useQuery({ queryKey: ['doctor', 'me'], queryFn: () => api.get('/doctors/me/profile').then((r) => r.data) });
  if (error) return <ErrorState error={error} />;
  if (pl || dl) return <ListSkeleton rows={5} height={120} />;
  return (
    <>
      <PageHeader title="ملفي" subtitle="هذه البيانات تظهر للمرضى في صفحتك" actions={provider?.verificationStatus === 'APPROVED' && <Button component={RouterLink} to={`/doctors/${provider.slug}`} variant="outlined">معاينة صفحتي</Button>} />
      <Grid container spacing={2}>
        <Grid xs={12} lg={7}>
          <DoctorForm doc={doc} approved={provider?.verificationStatus === 'APPROVED'} />
        </Grid>
        <Grid xs={12} lg={5}>
          <Stack spacing={2}>
            {provider && <DocumentsManager provider={provider} />}
            {provider && <BranchesManager provider={provider} />}
            {provider && <ServicesManager provider={provider} />}
            {provider && <ProviderInfoForm provider={provider} />}
          </Stack>
        </Grid>
      </Grid>
    </>
  );
}

function DoctorForm({ doc, approved }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data: specialties = [] } = useSpecialties();
  const { register, handleSubmit, control, reset, watch, formState } = useForm();
  useEffect(() => {
    if (!doc) return;
    const primary = doc.specialties.find((s) => s.isPrimary)?.specialtyId || '';
    reset({
      title: doc.title || 'د.',
      gender: doc.gender || '',
      bio: doc.bio || '',
      qualifications: doc.qualifications || '',
      licenseNumber: doc.licenseNumber || '',
      licenseAuthority: doc.licenseAuthority || '',
      experienceYears: doc.experienceYears,
      consultationPrice: doc.consultationPrice,
      onlinePrice: doc.onlinePrice ?? '',
      homeVisitPrice: doc.homeVisitPrice ?? '',
      onlineAvailable: doc.onlineAvailable,
      homeVisitAvailable: doc.homeVisitAvailable,
      languages: doc.languages || ['ar'],
      autoConfirm: doc.autoConfirm,
      cancellationWindowHours: doc.cancellationWindowHours,
      bookingHorizonDays: doc.bookingHorizonDays,
      primarySpecialtyId: primary,
      subSpecialtyIds: doc.specialties.filter((s) => !s.isPrimary).map((s) => s.specialtyId),
    });
  }, [doc, reset]);
  const primary = watch('primarySpecialtyId');
  const subs = specialties.filter((s) => s.parentId === primary);
  const save = async (v) => {
    const num = (x) => (x === '' || x === null || x === undefined ? undefined : Number(x));
    const body = {
      ...v,
      gender: v.gender || undefined,
      experienceYears: num(v.experienceYears),
      consultationPrice: num(v.consultationPrice),
      onlinePrice: v.onlinePrice === '' ? null : num(v.onlinePrice),
      homeVisitPrice: v.homeVisitPrice === '' ? null : num(v.homeVisitPrice),
      cancellationWindowHours: num(v.cancellationWindowHours),
      bookingHorizonDays: num(v.bookingHorizonDays),
      subSpecialtyIds: v.subSpecialtyIds.filter((id) => subs.some((s) => s.id === id)),
    };
    if (approved) {
      delete body.licenseNumber;
      delete body.licenseAuthority;
    }
    try {
      await api.patch('/doctors/me/profile', body);
      qc.invalidateQueries({ queryKey: ['doctor'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      enqueueSnackbar('تم حفظ الملف', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const roots = specialties.filter((s) => !s.parentId);
  const sw = (name, label) => <Controller name={name} control={control} render={({ field }) => <FormControlLabel control={<Switch checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />} label={label} />} />;
  return (
    <Section title="البيانات المهنية">
      <Stack component="form" spacing={2} onSubmit={handleSubmit(save)}>
        <Grid container spacing={2}>
          <Grid xs={4} sm={3}>
            <Controller name="title" control={control} defaultValue="د." render={({ field }) => <TextField select label="اللقب" {...field}>{['د.', 'أ.د.', 'أ.م.د.'].map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}</TextField>} />
          </Grid>
          <Grid xs={8} sm={3}>
            <Controller name="gender" control={control} defaultValue="" render={({ field }) => <TextField select label="النوع" {...field}><MenuItem value="">—</MenuItem><MenuItem value="MALE">طبيب</MenuItem><MenuItem value="FEMALE">طبيبة</MenuItem></TextField>} />
          </Grid>
          <Grid xs={12} sm={6}>
            <Controller name="languages" control={control} defaultValue={['ar']} render={({ field }) => <TextField select label="اللغات" SelectProps={{ multiple: true }} {...field}>{Object.entries(LANGUAGES).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}</TextField>} />
          </Grid>
          <Grid xs={12} sm={6}>
            <Controller name="primarySpecialtyId" control={control} defaultValue="" render={({ field }) => <TextField select label="التخصص الرئيسي" {...field}>{roots.map((s) => <MenuItem key={s.id} value={s.id}>{s.nameAr}</MenuItem>)}</TextField>} />
          </Grid>
          <Grid xs={12} sm={6}>
            <Controller name="subSpecialtyIds" control={control} defaultValue={[]} render={({ field }) => <TextField select label="تخصصات فرعية" SelectProps={{ multiple: true }} disabled={!subs.length} {...field}>{subs.map((s) => <MenuItem key={s.id} value={s.id}>{s.nameAr}</MenuItem>)}</TextField>} />
          </Grid>
          <Grid xs={12}><TextField label="نبذة تظهر للمرضى" multiline minRows={3} {...register('bio')} /></Grid>
          <Grid xs={12}><TextField label="المؤهلات" multiline minRows={2} {...register('qualifications')} /></Grid>
          <Grid xs={12} sm={6}><TextField label="رقم الترخيص" disabled={approved} helperText={approved ? 'للتعديل بعد الاعتماد تواصل مع الإدارة' : ''} {...register('licenseNumber')} /></Grid>
          <Grid xs={12} sm={6}><TextField label="جهة الترخيص" disabled={approved} {...register('licenseAuthority')} /></Grid>
          <Grid xs={12} sm={4}><TextField label="سنوات الخبرة" type="number" {...register('experienceYears')} /></Grid>
        </Grid>
        <Typography variant="h6">الأسعار وأنواع الكشف</Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid xs={12} sm={4}><TextField label="كشف العيادة (ج.م)" type="number" {...register('consultationPrice')} /></Grid>
          <Grid xs={6} sm={4}>{sw('onlineAvailable', 'كشف أونلاين')}</Grid>
          <Grid xs={6} sm={4}><TextField label="سعر الأونلاين" type="number" disabled={!watch('onlineAvailable')} {...register('onlinePrice')} /></Grid>
          <Grid xs={6} sm={4}>{sw('homeVisitAvailable', 'زيارات منزلية')}</Grid>
          <Grid xs={6} sm={4}><TextField label="سعر الزيارة المنزلية" type="number" disabled={!watch('homeVisitAvailable')} {...register('homeVisitPrice')} /></Grid>
        </Grid>
        <Typography variant="h6">سياسة الحجز</Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid xs={12} sm={4}>{sw('autoConfirm', 'تأكيد الحجوزات تلقائياً')}</Grid>
          <Grid xs={6} sm={4}><TextField label="أقل مدة للإلغاء (ساعات)" type="number" inputProps={{ min: 0, max: 72 }} {...register('cancellationWindowHours')} /></Grid>
          <Grid xs={6} sm={4}><TextField label="الحجز مقدماً حتى (يوم)" type="number" inputProps={{ min: 1, max: 180 }} {...register('bookingHorizonDays')} /></Grid>
        </Grid>
        <Box><Button type="submit" variant="contained" disabled={formState.isSubmitting}>حفظ الملف</Button></Box>
      </Stack>
    </Section>
  );
}
