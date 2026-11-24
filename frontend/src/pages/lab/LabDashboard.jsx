import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import { LAB_STATUS, useLabOrders, useMyLab } from '../../api/labs';
import { useRealtime } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section, StatCard } from '../../components/common';
import RangeBar, { rangeFor } from '../../components/RangeBar';
import { RankBars, TrendLine } from '../../components/Charts';
import { LabStatusChip } from '../../components/lab/LabUi';
import { fmtMoney, fmtTime, todayISO } from '../../utils/format';
import { tokens } from '../../theme';

const WARNINGS = {
  BRANCH_HOURS_MISSING: 'حدد مواعيد العمل لفرع واحد على الأقل حتى يتمكن المرضى من الحجز.',
  HOME_HOURS_MISSING: 'خدمة السحب المنزلي مفعّلة لكن لم تحدد مواعيدها.',
  NO_TESTS: 'أضف التحاليل وأسعارها لتظهر في صفحة المعمل وفي مقارنة الأسعار.',
};

export default function LabDashboard() {
  const [range, setRange] = useState(rangeFor(30));
  const qc = useQueryClient();
  useRealtime('lab:order', () => {
    qc.invalidateQueries({ queryKey: ['lab'] });
    qc.invalidateQueries({ queryKey: ['lab-orders'] });
  });
  const { data: me } = useMyLab();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['lab', 'dashboard', range],
    queryFn: () => api.get(`/labs/me/dashboard${qs(range)}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const today = todayISO();
  const { data: todays, isLoading: lt } = useLabOrders('lab', { from: `${today}T00:00:00+03:00`, to: `${today}T23:59:59+03:00`, status: 'NEW_ORDER,PAID,SAMPLE_COLLECTED', sortDir: 'asc', pageSize: 12 });
  const t = data?.today || {};
  const s = data?.totals || {};
  return (
    <>
      <PageHeader title="لوحة المعمل" subtitle={me?.provider?.nameAr} actions={<RangeBar value={range} onChange={setRange} />} />
      {me?.setupWarnings?.map((w) => (
        <Alert key={w} severity="warning" sx={{ mb: 1 }} action={<Button color="inherit" size="small" component={RouterLink} to={w === 'NO_TESTS' ? '/provider/catalog' : '/provider/lab-settings'}>إكمال</Button>}>{WARNINGS[w]}</Alert>
      ))}
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Grid container spacing={2}>
        <Grid xs={6} md={2}><StatCard tone="primary" label="طلبات اليوم" value={t.orders ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="عينات منتظرة" value={t.pendingSamples ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="جاري التحليل" value={t.processing ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard tone="accent" label="بانتظار الاعتماد" value={t.awaitingApproval ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="اكتمل اليوم" value={t.completedToday ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="سحب منزلي قادم" value={t.homeRequests ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الإيراد (الفترة)" value={fmtMoney(s.revenue)} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الطلبات" value={s.orders ?? 0} hint={`${s.patients ?? 0} مريض • ${s.cancelled ?? 0} ملغي`} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="متوسط زمن النتيجة" value={s.avgTurnaroundHours != null ? `${s.avgTurnaroundHours} ساعة` : '—'} hint="من سحب العينة للاعتماد" loading={isLoading} /></Grid>
        <Grid xs={6} md={3}>
          <Box component={RouterLink} to="/provider/orders?critical=true" sx={{ textDecoration: 'none' }}>
            <StatCard label="نتائج حرجة (الفترة)" value={s.criticalResults ?? 0} hint={`${s.pendingResults ?? 0} نتيجة لم تكتمل`} loading={isLoading} />
          </Box>
        </Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid xs={12} lg={7}>
          <Section title="مواعيد اليوم" action={<Button size="small" component={RouterLink} to="/provider/orders">كل الطلبات</Button>}>
            {lt ? <ListSkeleton rows={3} height={48} /> : todays?.items.length ? (
              <Stack divider={<Box sx={{ borderTop: `1px solid ${tokens.line}` }} />}>
                {todays.items.map((o) => (
                  <Stack key={o.id} component={RouterLink} to={`/provider/orders/${o.id}`} direction="row" spacing={2} alignItems="center" sx={{ py: 1, color: 'inherit', textDecoration: 'none' }}>
                    <Typography sx={{ fontWeight: 700, width: 72, color: tokens.petrol }}>{fmtTime(o.scheduledAt)}</Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600 }} noWrap>{o.patientName}</Typography>
                      <Typography variant="caption" color="text.secondary" dir="ltr" component="div" sx={{ textAlign: 'right' }} noWrap>{o.itemsLabel}</Typography>
                    </Box>
                    {o.homeCollection ? <Chip size="small" icon={<HomeOutlined />} label="منزلي" /> : <Typography variant="caption" color="text.secondary">{o.branchName}</Typography>}
                    <LabStatusChip value={o.status} />
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">لا توجد عينات مجدولة اليوم.</Typography>
            )}
          </Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="حالات الطلبات">
            <RankBars
              data={Object.keys(LAB_STATUS).map((k) => ({ label: LAB_STATUS[k].label, count: data?.statusSplit?.find((x) => x.status === k)?.count || 0 })).filter((x) => x.count)}
              labelKey="label"
              valueKey="count"
            />
          </Section>
        </Grid>
        <Grid xs={12} lg={7}>
          <Section title="الإيراد اليومي"><TrendLine data={data?.daily} dataKey="revenue" name="الإيراد" money /></Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="الأكثر طلباً"><RankBars data={data?.topTests?.map((x) => ({ ...x, label: x.name }))} labelKey="label" valueKey="count" unit=" طلب" /></Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="إيراد التحاليل (حجز منفرد)"><RankBars data={data?.topTests?.filter((x) => x.revenue > 0).map((x) => ({ label: x.name, revenue: x.revenue }))} labelKey="label" valueKey="revenue" unit=" ج.م" /></Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="إيراد الباقات"><RankBars data={data?.revenueByPackage} labelKey="name" valueKey="revenue" unit=" ج.م" /></Section>
        </Grid>
      </Grid>
    </>
  );
}
