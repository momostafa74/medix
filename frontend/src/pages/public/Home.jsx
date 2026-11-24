import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Button, ButtonBase, Container, InputAdornment, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useLocationsTree, useSpecialties } from '../../api/queries';
import DoctorCard from '../../components/DoctorCard';
import SpecialtyIcon from '../../components/SpecialtyIcon';
import { tokens } from '../../theme';

export default function Home() {
  const nav = useNavigate();
  const { data: specialties = [], isLoading: specLoading } = useSpecialties();
  const { data: tree = [] } = useLocationsTree();
  const [form, setForm] = useState({ specialtySlug: '', cityId: '', search: '' });
  const { data: top, isLoading } = useQuery({
    queryKey: ['doctors', 'top'],
    queryFn: () => api.get('/doctors?pageSize=4&sort=recommended').then((r) => r.data),
  });
  const roots = specialties.filter((s) => !s.parentId);
  const cities = tree.flatMap((g) => g.cities.map((c) => ({ ...c, gov: g.nameAr })));

  const submit = (e) => {
    e.preventDefault();
    const p = new URLSearchParams(Object.entries(form).filter(([, v]) => v));
    nav(`/doctors?${p}`);
  };

  return (
    <>
      <Box sx={{ bgcolor: tokens.petrol, color: '#fff', pt: { xs: 5, md: 8 }, pb: { xs: 9, md: 12 } }}>
        <Container maxWidth="lg">
          <Typography variant="h1" sx={{ fontSize: { xs: '2rem', md: '3rem' }, maxWidth: 720 }}>
            احجز كشفك في دقيقة، مع طبيب تعرف تقييمه وسعره قبل ما تروح
          </Typography>
          <Typography sx={{ mt: 2, maxWidth: 560, opacity: 0.85, fontSize: '1.1rem' }}>
            {top?.total ? `${top.total} طبيب معتمد` : 'أطباء معتمدون'} في {roots.length || 'كل'} تخصص. اختار الميعاد المتاح فعلاً واحجزه على طول.
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ mt: { xs: -6, md: -7 } }}>
        <Box
          component="form"
          onSubmit={submit}
          role="search"
          sx={{ bgcolor: '#fff', borderRadius: '14px', border: `1px solid ${tokens.line}`, p: { xs: 2, md: 2.5 }, boxShadow: '0 12px 30px -18px rgba(15,76,92,.45)' }}
        >
          <Grid container spacing={1.5} alignItems="center">
            <Grid xs={12} md={3.5}>
              <TextField select label="التخصص" value={form.specialtySlug} onChange={(e) => setForm({ ...form, specialtySlug: e.target.value })}>
                <MenuItem value="">كل التخصصات</MenuItem>
                {roots.map((s) => (
                  <MenuItem key={s.id} value={s.slug}>
                    {s.nameAr}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid xs={12} md={3}>
              <TextField select label="المدينة" value={form.cityId} onChange={(e) => setForm({ ...form, cityId: e.target.value })}>
                <MenuItem value="">كل المدن</MenuItem>
                {cities.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.nameAr} — {c.gov}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid xs={12} md={3.5}>
              <TextField
                label="اسم الطبيب (اختياري)"
                value={form.search}
                onChange={(e) => setForm({ ...form, search: e.target.value })}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
              />
            </Grid>
            <Grid xs={12} md={2}>
              <Button type="submit" variant="contained" color="secondary" fullWidth size="large" sx={{ minHeight: 44, fontSize: 16 }}>
                ابحث
              </Button>
            </Grid>
          </Grid>
        </Box>
        <Grid container spacing={1.5} sx={{ mt: 1.5 }}>
          {[
            ['/lab-tests', 'قارن أسعار التحاليل', 'واحجز سحب منزلي أو في الفرع'],
            ['/radiology-services', 'احجز أشعة', 'رنين، مقطعية، سونار وأكثر'],
            ['/medicines', 'اطلب دواءك', 'قارن الأسعار في الصيدليات واطلب توصيل'],
          ].map(([to, t, sub]) => (
            <Grid key={to} xs={12} sm={4}>
              <Box component={RouterLink} to={to} sx={{ display: 'block', p: 2, borderRadius: '12px', border: `1px solid ${tokens.line}`, bgcolor: '#fff', textDecoration: 'none', color: 'inherit', '&:hover': { borderColor: tokens.petrol } }}>
                <Typography sx={{ fontWeight: 700, color: tokens.petrol }}>{t}</Typography>
                <Typography variant="body2" color="text.secondary">{sub}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Container>

      <Container maxWidth="lg" sx={{ mt: 7 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2 }}>
          <Typography variant="h3" component="h2">
            التخصصات
          </Typography>
          <Button component={RouterLink} to="/specialties">
            عرض الكل
          </Button>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(5,1fr)' }, gap: 1.5 }}>
          {specLoading
            ? Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} variant="rounded" height={92} />)
            : roots.slice(0, 10).map((s) => (
                <ButtonBase
                  key={s.id}
                  component={RouterLink}
                  to={`/doctors?specialtySlug=${s.slug}`}
                  sx={{ justifyContent: 'flex-start', gap: 1.5, p: 2, borderRadius: '12px', border: `1px solid ${tokens.line}`, bgcolor: '#fff', '&:hover': { borderColor: tokens.petrol } }}
                >
                  <Box sx={{ width: 40, height: 40, borderRadius: '10px', bgcolor: tokens.mint, color: tokens.petrol, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <SpecialtyIcon name={s.icon} />
                  </Box>
                  <Box sx={{ textAlign: 'start' }}>
                    <Typography sx={{ fontWeight: 600, lineHeight: 1.4 }}>{s.nameAr}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {s.doctorCount ? `${s.doctorCount} طبيب` : 'قريباً'}
                    </Typography>
                  </Box>
                </ButtonBase>
              ))}
        </Box>
      </Container>

      <Container maxWidth="lg" sx={{ mt: 7 }}>
        <Typography variant="h3" component="h2" sx={{ mb: 3 }}>
          الحجز في ثلاث خطوات
        </Typography>
        <Grid container spacing={3}>
          {[
            ['اختار الطبيب', 'قارن بين الأطباء بالتخصص والمنطقة والسعر وتقييمات المرضى الحقيقية.'],
            ['اختار الميعاد', 'بتشوف المواعيد المتاحة فعلاً في جدول الطبيب — مفيش ميعاد بيتحجز مرتين.'],
            ['احجز وتابع', 'يوصلك تأكيد وتذكير قبل الميعاد، وتقدر تلغي أو تغيّر الميعاد من حسابك.'],
          ].map(([title, body], i) => (
            <Grid xs={12} md={4} key={title}>
              <Stack direction="row" spacing={2}>
                <Typography sx={{ fontSize: 40, fontWeight: 700, color: tokens.saffron, lineHeight: 1 }}>{i + 1}</Typography>
                <Box>
                  <Typography variant="h5" component="h3">
                    {title}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    {body}
                  </Typography>
                </Box>
              </Stack>
            </Grid>
          ))}
        </Grid>
      </Container>

      <Container maxWidth="lg" sx={{ mt: 7 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2 }}>
          <Typography variant="h3" component="h2">
            أطباء بتقييمات عالية
          </Typography>
          <Button component={RouterLink} to="/doctors">
            كل الأطباء
          </Button>
        </Stack>
        <Stack spacing={1.5}>
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={150} />)
            : top?.items?.map((d) => <DoctorCard key={d.id} d={d} />)}
        </Stack>
      </Container>

      <Container maxWidth="lg" sx={{ mt: 7 }}>
        <Box sx={{ borderRadius: '14px', bgcolor: tokens.saffronSoft, p: { xs: 3, md: 4 }, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h4" component="h2">
              أنت طبيب؟
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 560 }}>
              سجّل عيادتك ونظّم جدولك ومواعيدك في مكان واحد. بنراجع بيانات الترخيص قبل ما ملفك يظهر للمرضى.
            </Typography>
          </Box>
          <Button component={RouterLink} to="/register/doctor" variant="contained" size="large">
            سجّل كطبيب
          </Button>
        </Box>
      </Container>
    </>
  );
}
