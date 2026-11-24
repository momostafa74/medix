import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Drawer,
  FormControlLabel,
  
  InputAdornment,
  MenuItem,
  Pagination,
  Rating,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import TuneIcon from '@mui/icons-material/Tune';
import { useTheme } from '@mui/material/styles';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import { useSpecialties } from '../../api/queries';
import DoctorCard from '../../components/DoctorCard';
import LocationSelect from '../../components/LocationSelect';
import { EmptyState, ErrorState, ListSkeleton, useDebounced } from '../../components/common';
import { todayISO } from '../../utils/format';

const SORTS = { recommended: 'الأنسب', rating: 'الأعلى تقييماً', price_asc: 'الأقل سعراً', price_desc: 'الأعلى سعراً', experience: 'الأكثر خبرة' };
const FILTER_KEYS = ['search', 'specialtySlug', 'governorateId', 'cityId', 'areaId', 'minPrice', 'maxPrice', 'minRating', 'gender', 'online', 'homeVisit', 'availableOn', 'sort', 'page'];

export default function Doctors() {
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const [searchText, setSearchText] = useState(f.search);
  const search = useDebounced(searchText);
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [drawer, setDrawer] = useState(false);
  const { data: specialties = [] } = useSpecialties();

  const set = (patch) => {
    const next = { ...f, ...patch };
    if (!('page' in patch)) next.page = '';
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '' && v !== undefined && v !== false)), { replace: true });
  };
  useEffect(() => {
    if (search !== f.search) set({ search });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const page = parseInt(f.page || '1', 10);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['doctors', 'search', f],
    queryFn: () => api.get(`/doctors${qs({ ...f, page, pageSize: 10 })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const activeCount = ['specialtySlug', 'governorateId', 'cityId', 'areaId', 'minPrice', 'maxPrice', 'minRating', 'gender', 'online', 'homeVisit', 'availableOn'].filter((k) => f[k]).length;

  const filters = (
    <Stack spacing={2.25}>
      <TextField select label="التخصص" value={f.specialtySlug} onChange={(e) => set({ specialtySlug: e.target.value })}>
        <MenuItem value="">كل التخصصات</MenuItem>
        {specialties.map((s) => (
          <MenuItem key={s.id} value={s.slug} sx={{ pl: s.parentId ? 4 : 2 }}>
            {s.parentId ? `— ${s.nameAr}` : s.nameAr}
          </MenuItem>
        ))}
      </TextField>
      <LocationSelect direction="column" value={{ governorateId: f.governorateId, cityId: f.cityId, areaId: f.areaId }} onChange={(v) => set({ governorateId: v.governorateId || '', cityId: v.cityId || '', areaId: v.areaId || '' })} />
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
          سعر الكشف (ج.م)
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField label="من" type="number" inputProps={{ min: 0 }} value={f.minPrice} onChange={(e) => set({ minPrice: e.target.value })} />
          <TextField label="إلى" type="number" inputProps={{ min: 0 }} value={f.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} />
        </Stack>
      </Box>
      <Box>
        <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 600 }}>
          التقييم من
        </Typography>
        <Rating value={Number(f.minRating) || 0} onChange={(_, v) => set({ minRating: v ? String(v) : '' })} />
      </Box>
      <TextField select label="جنس الطبيب" value={f.gender} onChange={(e) => set({ gender: e.target.value })}>
        <MenuItem value="">الكل</MenuItem>
        <MenuItem value="MALE">طبيب</MenuItem>
        <MenuItem value="FEMALE">طبيبة</MenuItem>
      </TextField>
      <TextField label="متاح يوم" type="date" InputLabelProps={{ shrink: true }} inputProps={{ min: todayISO() }} value={f.availableOn} onChange={(e) => set({ availableOn: e.target.value })} />
      <FormControlLabel control={<Switch checked={f.online === 'true'} onChange={(e) => set({ online: e.target.checked ? 'true' : '' })} />} label="كشف أونلاين" />
      <FormControlLabel control={<Switch checked={f.homeVisit === 'true'} onChange={(e) => set({ homeVisit: e.target.checked ? 'true' : '' })} />} label="زيارة منزلية" />
      {activeCount > 0 && (
        <Button onClick={() => { setSearchText(''); setParams({}, { replace: true }); }}>مسح كل الفلاتر</Button>
      )}
    </Stack>
  );

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1">
        ابحث عن طبيب
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2, mb: 3 }}>
        <TextField
          placeholder="اسم الطبيب أو التخصص"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
          inputProps={{ 'aria-label': 'بحث' }}
        />
        <TextField select value={f.sort || 'recommended'} onChange={(e) => set({ sort: e.target.value === 'recommended' ? '' : e.target.value })} sx={{ minWidth: 180 }} inputProps={{ 'aria-label': 'الترتيب' }}>
          {Object.entries(SORTS).map(([k, v]) => (
            <MenuItem key={k} value={k}>
              {v}
            </MenuItem>
          ))}
        </TextField>
        {!desktop && (
          <Button variant="outlined" startIcon={<TuneIcon />} onClick={() => setDrawer(true)} sx={{ flexShrink: 0 }}>
            الفلاتر{activeCount ? ` (${activeCount})` : ''}
          </Button>
        )}
      </Stack>
      <Grid container spacing={3}>
        {desktop && (
          <Grid md={3}>
            <Box sx={{ position: 'sticky', top: 88 }}>{filters}</Box>
          </Grid>
        )}
        <Grid xs={12} md={9}>
          {error && <ErrorState error={error} onRetry={refetch} />}
          <Typography color="text.secondary" sx={{ mb: 1.5 }} aria-live="polite">
            {data ? `${data.total} طبيب` : ' '}
          </Typography>
          {isLoading ? (
            <ListSkeleton rows={4} height={150} />
          ) : data?.items.length ? (
            <Stack spacing={1.5} sx={{ opacity: isFetching ? 0.6 : 1 }}>
              {data.items.map((d) => (
                <DoctorCard key={d.id} d={d} />
              ))}
            </Stack>
          ) : (
            <EmptyState title="لا يوجد أطباء بهذه المواصفات" body="جرّب توسيع نطاق البحث: غيّر المنطقة أو امسح بعض الفلاتر." />
          )}
          {data?.totalPages > 1 && (
            <Stack alignItems="center" sx={{ mt: 3 }}>
              <Pagination count={data.totalPages} page={page} onChange={(_, p) => { set({ page: String(p) }); window.scrollTo({ top: 0 }); }} color="primary" />
            </Stack>
          )}
        </Grid>
      </Grid>
      <Drawer anchor="bottom" open={drawer} onClose={() => setDrawer(false)} PaperProps={{ sx: { borderRadius: '14px 14px 0 0', p: 2.5, maxHeight: '85vh' } }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          الفلاتر
        </Typography>
        {filters}
        <Button variant="contained" sx={{ mt: 2 }} onClick={() => setDrawer(false)}>
          عرض {data?.total ?? ''} نتيجة
        </Button>
      </Drawer>
    </Container>
  );
}
