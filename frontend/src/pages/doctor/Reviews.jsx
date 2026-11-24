import { useState } from 'react';
import { Box, LinearProgress, Pagination, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { EmptyState, ListSkeleton, PageHeader, Section, StatCard } from '../../components/common';
import { fmtShortDate } from '../../utils/format';
import { tokens } from '../../theme';

export default function ReviewsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['reviews', 'received', page], queryFn: () => api.get(`/reviews/received?page=${page}&pageSize=10`).then((r) => r.data) });
  const s = data?.summary || {};
  return (
    <>
      <PageHeader title="التقييمات" />
      <Grid container spacing={2}>
        <Grid xs={12} md={4}>
          <Stack spacing={2}>
            <StatCard tone="accent" label="متوسط التقييم" value={s.count ? `${s.avg} / 5` : '—'} hint={`${s.count ?? 0} تقييم منشور`} loading={isLoading} />
            <Section title="توزيع التقييمات">
              {[5, 4, 3, 2, 1].map((n) => (
                <Stack key={n} direction="row" alignItems="center" spacing={1} sx={{ py: 0.4 }}>
                  <Typography sx={{ width: 28 }}>{n}★</Typography>
                  <LinearProgress variant="determinate" value={s.count ? ((s[`r${n}`] || 0) / s.count) * 100 : 0} sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: tokens.paper, '& .MuiLinearProgress-bar': { bgcolor: tokens.saffron } }} />
                  <Typography variant="body2" sx={{ width: 28 }}>{s[`r${n}`] || 0}</Typography>
                </Stack>
              ))}
            </Section>
          </Stack>
        </Grid>
        <Grid xs={12} md={8}>
          <Section>
            {isLoading ? <ListSkeleton /> : data?.items.length ? data.items.map((r) => (
              <Box key={r.id} sx={{ py: 1.25, borderBottom: `1px solid ${tokens.line}`, '&:last-child': { borderBottom: 0 } }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography sx={{ fontWeight: 600 }}>{r.patient?.user?.fullName?.split(' ')[0]}</Typography>
                  <Typography variant="caption" color="text.secondary">{fmtShortDate(r.createdAt)}{r.status !== 'PUBLISHED' && ' • مخفي بواسطة الإدارة'}</Typography>
                </Stack>
                <Typography sx={{ color: tokens.saffron }}>{'★'.repeat(r.rating)}<span style={{ color: tokens.line }}>{'★'.repeat(5 - r.rating)}</span></Typography>
                {r.comment && <Typography>{r.comment}</Typography>}
              </Box>
            )) : <EmptyState title="لا توجد تقييمات بعد" body="بعد إتمام الكشف يمكن للمريض تقييم زيارته." />}
            {data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 2 }}><Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} /></Stack>}
          </Section>
        </Grid>
      </Grid>
    </>
  );
}
