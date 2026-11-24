import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Button, MenuItem, Stack, TextField } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import LocationSelect from '../../components/LocationSelect';
import { ListSkeleton, PageHeader, Section } from '../../components/common';

export default function PatientProfile() {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading } = useQuery({ queryKey: ['patient', 'me'], queryFn: () => api.get('/patients/me').then((r) => r.data) });
  const [loc, setLoc] = useState({});
  const { register, handleSubmit, control, reset, formState } = useForm();
  useEffect(() => {
    if (!data) return;
    reset({
      dateOfBirth: data.dateOfBirth || '',
      gender: data.gender || '',
      bloodType: data.bloodType || '',
      address: data.address || '',
      emergencyContactName: data.emergencyContactName || '',
      emergencyContactPhone: data.emergencyContactPhone || '',
    });
    setLoc({ cityId: data.cityId || undefined, areaId: data.areaId || undefined });
  }, [data, reset]);
  const save = async (v) => {
    try {
      const body = Object.fromEntries(Object.entries({ ...v, cityId: loc.cityId || null, areaId: loc.areaId || null }).map(([k, x]) => [k, x === '' ? null : x]));
      await api.patch('/patients/me', body);
      qc.invalidateQueries({ queryKey: ['patient', 'me'] });
      enqueueSnackbar('تم الحفظ', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  if (isLoading) return <ListSkeleton />;
  return (
    <>
      <PageHeader title="بياناتي الشخصية" subtitle="الاسم ورقم الموبايل والصورة تجدها في الإعدادات" />
      <Section>
        <Stack component="form" spacing={2} onSubmit={handleSubmit(save)}>
          <Grid container spacing={2}>
            <Grid xs={12} sm={4}><TextField type="date" label="تاريخ الميلاد" InputLabelProps={{ shrink: true }} {...register('dateOfBirth')} /></Grid>
            <Grid xs={12} sm={4}>
              <Controller name="gender" control={control} defaultValue="" render={({ field }) => (
                <TextField select label="النوع" {...field}><MenuItem value="">—</MenuItem><MenuItem value="MALE">ذكر</MenuItem><MenuItem value="FEMALE">أنثى</MenuItem></TextField>
              )} />
            </Grid>
            <Grid xs={12} sm={4}>
              <Controller name="bloodType" control={control} defaultValue="" render={({ field }) => (
                <TextField select label="فصيلة الدم" {...field}><MenuItem value="">—</MenuItem>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <MenuItem key={b} value={b} dir="ltr">{b}</MenuItem>)}</TextField>
              )} />
            </Grid>
          </Grid>
          <LocationSelect value={loc} onChange={setLoc} />
          <TextField label="العنوان" {...register('address')} />
          <Grid container spacing={2}>
            <Grid xs={12} sm={6}><TextField label="اسم شخص للطوارئ" {...register('emergencyContactName')} /></Grid>
            <Grid xs={12} sm={6}><TextField label="رقم الطوارئ" inputProps={{ dir: 'ltr' }} {...register('emergencyContactPhone')} /></Grid>
          </Grid>
          <Stack direction="row"><Button type="submit" variant="contained" disabled={formState.isSubmitting}>حفظ التغييرات</Button></Stack>
        </Stack>
      </Section>
    </>
  );
}
