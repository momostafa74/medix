import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Avatar, Box, Button, Card, Chip, Container, InputAdornment, Pagination, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api, fileUrl, qs } from '../../api/client';
import LocationSelect from '../../components/LocationSelect';
import { Rating } from '../../components/DoctorCard';
import { EmptyState, ErrorState, ListSkeleton, useDebounced } from '../../components/common';
import { tokens } from '../../theme';

const COPY = {
  LABORATORY: { title: 'معامل التحاليل', empty: 'لا توجد معامل في هذه المنطقة بعد' },
  RADIOLOGY: { title: 'مراكز الأشعة', empty: 'لا توجد مراكز أشعة في هذه المنطقة بعد' },
  PHARMACY: { title: 'الصيدليات', empty: 'لا توجد صيدليات في هذه المنطقة بعد' },
};

export default function Providers({ type }) {
  const [loc, setLoc] = useState({});
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['providers', type, loc, search, page],
    queryFn: () => api.get(`/providers${qs({ type, ...loc, search, page, pageSize: 10 })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
        <Typography variant="h3" component="h1">
          {COPY[type].title}
        </Typography>
        {type === 'LABORATORY' && (
          <Button component={RouterLink} to="/lab-tests" variant="contained">
            قارن أسعار تحليل
          </Button>
        )}
        {type === 'RADIOLOGY' && (
          <Button component={RouterLink} to="/radiology-services" variant="contained">
            ابحث عن فحص أشعة
          </Button>
        )}
      </Stack>
      <Stack spacing={1.5} sx={{ my: 3 }}>
        <TextField placeholder="ابحث بالاسم" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} inputProps={{ 'aria-label': 'بحث' }} />
        <LocationSelect value={loc} onChange={(v) => { setLoc(v); setPage(1); }} />
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? (
        <ListSkeleton rows={3} height={120} />
      ) : data?.items.length ? (
        <Stack spacing={1.5}>
          {data.items.map((p) => (
            <ProviderRow key={p.id} p={p} />
          ))}
        </Stack>
      ) : (
        <EmptyState title={COPY[type].empty} body="جرّب البحث في منطقة أخرى." />
      )}
      {data?.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 3 }}>
          <Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" />
        </Stack>
      )}
    </Container>
  );
}

export function ProviderRow({ p }) {
  const b = p.branches?.[0];
  return (
    <Card sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Avatar variant="rounded" src={fileUrl(p.logoFileId) || undefined} sx={{ width: 64, height: 64, bgcolor: tokens.mint, color: tokens.petrol, fontWeight: 700 }}>
          {p.nameAr?.[0]}
        </Avatar>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" component="h2">
            {p.nameAr}
          </Typography>
          {p.description && (
            <Typography variant="body2" color="text.secondary">
              {p.description}
            </Typography>
          )}
          <Stack direction="row" spacing={2} sx={{ mt: 0.5 }} alignItems="center" flexWrap="wrap" useFlexGap>
            <Rating value={p.ratingAvg} count={p.ratingCount} />
            {b && (
              <Stack direction="row" spacing={0.5} sx={{ color: 'text.secondary' }}>
                <PlaceOutlined sx={{ fontSize: 18 }} />
                <Typography variant="body2">{[b.area?.nameAr, b.city?.nameAr].filter(Boolean).join('، ')}</Typography>
              </Stack>
            )}
            {p.homeServiceAvailable && <Chip size="small" variant="outlined" label="خدمة منزلية" />}
            {p.branches?.length > 1 && <Chip size="small" variant="outlined" label={`${p.branches.length} فروع`} />}
          </Stack>
        </Box>
        <Button component={RouterLink} to={`/providers/${p.slug}`} variant="outlined">
          التفاصيل
        </Button>
      </Stack>
    </Card>
  );
}
