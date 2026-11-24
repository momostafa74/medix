import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Avatar, Box, Button, Card, Chip, Container, InputAdornment, Pagination, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, fileUrl, qs } from '../../api/client';
import LocationSelect from '../../components/LocationSelect';
import { EmptyState, ErrorState, ListSkeleton, useDebounced } from '../../components/common';
import { fmtMoney } from '../../utils/format';
import { tokens } from '../../theme';

/** Search a test once, see every lab's price side by side. */
export default function LabTests() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') || '');
  const [loc, setLoc] = useState({});
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['lab-tests', search, loc, page],
    queryFn: () => api.get(`/lab-tests/search${qs({ search, ...loc, page, pageSize: 8 })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1">قارن أسعار التحاليل</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>اكتب اسم التحليل أو كوده (CBC، سكر، فيتامين د…) وشوف سعره في كل المعامل واحجز من نفس الصفحة.</Typography>
      <Stack spacing={1.5} sx={{ my: 3 }}>
        <TextField
          autoFocus
          placeholder="مثال: صورة دم كاملة أو CBC"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPage(1);
            setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
          }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
          inputProps={{ 'aria-label': 'ابحث عن تحليل' }}
        />
        <LocationSelect value={loc} onChange={(v) => { setLoc(v); setPage(1); }} />
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? (
        <ListSkeleton rows={3} height={160} />
      ) : data?.items.length ? (
        <Stack spacing={2}>
          {data.items.map((g) => (
            <Card key={g.code} sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 1.5 }}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="baseline">
                    <Typography variant="h6" component="h2">{g.name}</Typography>
                    <Typography variant="body2" color="text.secondary" dir="ltr">{g.code}</Typography>
                  </Stack>
                  {g.offers[0]?.preparationInstructions && <Typography variant="body2" sx={{ color: '#8A5A00' }}>تحضير: {g.offers[0].preparationInstructions}</Typography>}
                </Box>
                <Box sx={{ textAlign: { sm: 'left' } }}>
                  <Typography variant="body2" color="text.secondary">{g.offers.length} {g.offers.length === 1 ? 'معمل' : 'معامل'}</Typography>
                  <Typography sx={{ fontWeight: 700, color: tokens.petrol }}>
                    {g.minPrice === g.maxPrice ? fmtMoney(g.minPrice) : `${fmtMoney(g.minPrice)} – ${fmtMoney(g.maxPrice)}`}
                  </Typography>
                </Box>
              </Stack>
              <Stack spacing={1}>
                {g.offers.map((o, i) => (
                  <Stack
                    key={o.testId}
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems={{ sm: 'center' }}
                    spacing={1.5}
                    sx={{ p: 1.25, borderRadius: '10px', border: `1px solid ${i === 0 && g.offers.length > 1 ? tokens.saffron : tokens.line}`, bgcolor: i === 0 && g.offers.length > 1 ? tokens.saffronSoft : '#fff' }}
                  >
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                      <Avatar variant="rounded" src={fileUrl(o.logoFileId) || undefined} sx={{ width: 40, height: 40, bgcolor: tokens.mint, color: tokens.petrol, fontWeight: 700 }}>{o.labName[0]}</Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600 }} noWrap component={RouterLink} to={`/providers/${o.slug}`} color="inherit" style={{ textDecoration: 'none' }}>{o.labName}</Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {i === 0 && g.offers.length > 1 && <Chip size="small" label="الأقل سعراً" sx={{ bgcolor: tokens.saffron, color: tokens.ink, fontWeight: 600 }} />}
                          {o.homeCollection && <Chip size="small" variant="outlined" icon={<HomeOutlined />} label="سحب منزلي" />}
                          {o.turnaroundHours && <Chip size="small" variant="outlined" icon={<ScheduleOutlined />} label={`النتيجة خلال ${o.turnaroundHours} ساعة`} />}
                        </Stack>
                      </Box>
                    </Stack>
                    <Typography sx={{ fontWeight: 700, fontSize: 18, minWidth: 90 }}>{fmtMoney(o.price)}</Typography>
                    <Button variant="contained" component={RouterLink} to={`/labs/${o.slug}/book?tests=${o.testId}`}>احجز</Button>
                  </Stack>
                ))}
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : (
        <EmptyState title={search ? 'لم نجد تحليلاً بهذا الاسم' : 'لا توجد تحاليل متاحة بعد'} body="جرّب اسماً آخر أو الكود الإنجليزي للتحليل، أو وسّع نطاق المنطقة." />
      )}
      {data?.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 3 }}>
          <Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" />
        </Stack>
      )}
    </Container>
  );
}
