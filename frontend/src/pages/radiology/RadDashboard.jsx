import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import { MODALITY, useMyCenter, useRadOrders } from '../../api/radiology';
import { useRealtime } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section, StatCard } from '../../components/common';
import RangeBar, { rangeFor } from '../../components/RangeBar';
import { RankBars, TrendLine } from '../../components/Charts';
import { RadStatusChip } from '../../components/radiology/RadUi';
import { fmtMoney, fmtTime, todayISO } from '../../utils/format';
import { tokens } from '../../theme';

const WARNINGS = {
  NO_SERVICES: 'أضف خدمات الأشعة وأسعارها لتظهر للمرضى.',
  BRANCH_HOURS_MISSING: 'حدد مواعيد العمل لفرع واحد على الأقل.',
  NO_DEVICES: 'حدد عدد الأجهزة في كل فرع حتى تظهر مواعيد الحجز.',
};

export default function RadDashboard() {
  const [range, setRange] = useState(rangeFor(30));
  const qc = useQueryClient();
  useRealtime('radiology:order', () => {
    qc.invalidateQueries({ queryKey: ['radiology'] });
    qc.invalidateQueries({ queryKey: ['radiology-orders'] });
  });
  const { data: me } = useMyCenter();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['radiology', 'dashboard', range],
    queryFn: () => api.get(`/radiology-center/me/dashboard${qs(range)}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const today = todayISO();
  const { data: todays, isLoading: lt } = useRadOrders('center', { from: `${today}T00:00:00+03:00`, to: `${today}T23:59:59+03:00`, status: 'BOOKED,CHECKED_IN,EXAMINATION', sortDir: 'asc', pageSize: 15 });
  const t = data?.today || {};
  const s = data?.totals || {};
  return (
    <>
      <PageHeader title="لوحة مركز الأشعة" subtitle={me?.provider?.nameAr} actions={<RangeBar value={range} onChange={setRange} />} />
      {me?.setupWarnings?.map((w) => (
        <Alert key={w} severity="warning" sx={{ mb: 1 }} action={<Button color="inherit" size="small" component={RouterLink} to={w === 'NO_SERVICES' ? '/provider/services' : '/provider/radiology-settings'}>إكمال</Button>}>{WARNINGS[w]}</Alert>
      ))}
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Grid container spacing={2}>
        <Grid xs={6} md={2}><StatCard tone="primary" label="حجوزات اليوم" value={t.bookings ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="فحوصات منتظرة" value={t.pendingExams ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="جاري الفحص" value={t.inExam ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="قائمة التقارير" value={t.reporting ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard tone="accent" label="بانتظار الاعتماد" value={t.awaitingApproval ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="اعتُمد اليوم" value={t.approvedToday ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الإيراد (الفترة)" value={fmtMoney(s.revenue)} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الحجوزات" value={s.bookings ?? 0} hint={`${s.patients ?? 0} مريض • ${s.noShows ?? 0} لم يحضر`} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="متوسط زمن التقرير" value={s.avgReportHours != null ? `${s.avgReportHours} ساعة` : '—'} hint="من انتهاء الفحص للاعتماد" loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="تقارير عاجلة" value={s.criticalReports ?? 0} hint={`${s.cancelled ?? 0} ملغي`} loading={isLoading} /></Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid xs={12} lg={7}>
          <Section title="جدول اليوم" action={<Button size="small" component={RouterLink} to="/provider/bookings">كل الحجوزات</Button>}>
            {lt ? <ListSkeleton rows={3} height={48} /> : todays?.items.length ? (
              <Stack divider={<Box sx={{ borderTop: `1px solid ${tokens.line}` }} />}>
                {todays.items.map((o) => (
                  <Stack key={o.id} component={RouterLink} to={`/provider/bookings/${o.id}`} direction="row" spacing={2} alignItems="center" sx={{ py: 1, color: 'inherit', textDecoration: 'none' }}>
                    <Typography sx={{ fontWeight: 700, width: 72, color: tokens.petrol }}>{fmtTime(o.scheduledAt)}</Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600 }} noWrap>{o.patientName}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">{o.serviceName} • {o.branchName}</Typography>
                    </Box>
                    <Chip size="small" variant="outlined" label={MODALITY[o.modality] || o.modality} />
                    <RadStatusChip value={o.status} />
                  </Stack>
                ))}
              </Stack>
            ) : <Typography color="text.secondary">لا توجد فحوصات متبقية اليوم.</Typography>}
          </Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="حسب نوع الجهاز"><RankBars data={data?.byModality} labelKey="label" valueKey="count" unit=" فحص" /></Section>
        </Grid>
        <Grid xs={12} lg={7}>
          <Section title="الإيراد اليومي"><TrendLine data={data?.daily} dataKey="revenue" name="الإيراد" money /></Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="الخدمات الأكثر طلباً"><RankBars data={data?.byService} labelKey="name" valueKey="count" unit=" حجز" /></Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="الإيراد حسب الخدمة"><RankBars data={data?.byService?.filter((x) => x.revenue > 0)} labelKey="name" valueKey="revenue" unit=" ج.م" /></Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="أداء الفروع">
            {data?.byBranch?.length ? (
              <Stack spacing={1}>
                {data.byBranch.map((b) => (
                  <Stack key={b.name} direction="row" justifyContent="space-between" sx={{ p: 1.25, borderRadius: '10px', border: `1px solid ${tokens.line}` }}>
                    <Typography sx={{ fontWeight: 600 }}>{b.name}</Typography>
                    <Typography variant="body2" color="text.secondary">{b.count} حجز • {fmtMoney(b.revenue)} • {b.no_shows} لم يحضر</Typography>
                  </Stack>
                ))}
              </Stack>
            ) : <Typography color="text.secondary">لا توجد بيانات.</Typography>}
          </Section>
        </Grid>
      </Grid>
    </>
  );
}
