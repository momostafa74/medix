import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import { FULFILLMENT, useMyPharmacy, usePhOrders } from '../../api/pharmacy';
import { useRealtime } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section, StatCard } from '../../components/common';
import RangeBar, { rangeFor } from '../../components/RangeBar';
import { RankBars, TrendLine } from '../../components/Charts';
import { PhStatusChip } from '../../components/pharmacy/PhUi';
import { fmtMoney, fmtRelative } from '../../utils/format';
import { tokens } from '../../theme';

const WARNINGS = {
  NO_INVENTORY: ['أضف الأدوية والمنتجات وأسعارها لتظهر صيدليتك في نتائج البحث.', '/provider/inventory'],
  BRANCH_HOURS_MISSING: ['حدد مواعيد العمل لفرع واحد على الأقل (أو فعّل 24 ساعة).', '/provider/pharmacy-settings'],
  DELIVERY_FEE_MISSING: ['حدد رسوم التوصيل.', '/provider/pharmacy-settings'],
};

export default function PhDashboard() {
  const [range, setRange] = useState(rangeFor(30));
  const qc = useQueryClient();
  useRealtime('pharmacy:order', () => {
    qc.invalidateQueries({ queryKey: ['pharmacy', 'dashboard'] });
    qc.invalidateQueries({ queryKey: ['pharmacy-orders'] });
  });
  const { data: me } = useMyPharmacy();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pharmacy', 'dashboard', range],
    queryFn: () => api.get(`/pharmacy/me/dashboard${qs(range)}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const { data: open, isLoading: lo } = usePhOrders('pharmacy', { status: 'PENDING,CONFIRMED,PREPARING,READY,OUT_FOR_DELIVERY', sortDir: 'asc', pageSize: 12 });
  const l = data?.live || {};
  const t = data?.totals || {};
  return (
    <>
      <PageHeader title="لوحة الصيدلية" subtitle={me?.provider?.nameAr} actions={<RangeBar value={range} onChange={setRange} />} />
      {me?.setupWarnings?.map((w) => (
        <Alert key={w} severity="warning" sx={{ mb: 1 }} action={<Button color="inherit" size="small" component={RouterLink} to={WARNINGS[w]?.[1] || '/provider'}>إكمال</Button>}>{WARNINGS[w]?.[0] || w}</Alert>
      ))}
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Grid container spacing={2}>
        <Grid xs={6} md={2}><StatCard tone="primary" label="طلبات جديدة" value={l.pending ?? 0} hint={`${l.newToday ?? 0} طلب اليوم`} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="مؤكدة" value={l.confirmed ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="جاري التجهيز" value={l.preparing ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="جاهزة" value={l.ready ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard tone="accent" label="في الطريق" value={l.outForDelivery ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="سُلّمت اليوم" value={l.deliveredToday ?? 0} hint={`${fmtMoney(l.revenueToday)} • ${l.cancelledToday ?? 0} ملغي`} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="المبيعات (الفترة)" value={fmtMoney(t.revenue)} hint={`متوسط الطلب ${fmtMoney(t.avgOrder)}`} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الطلبات" value={t.orders ?? 0} hint={`${t.delivered ?? 0} سُلّم • ${t.cancelled ?? 0} ملغي`} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="العملاء" value={t.customers ?? 0} hint={`${t.repeatCustomers ?? 0} عميل متكرر`} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="متوسط وقت التوصيل" value={t.avgDeliveryMinutes != null ? `${t.avgDeliveryMinutes} د` : '—'} hint={`${t.deliveryOrders ?? 0} توصيل • ${t.pickupOrders ?? 0} استلام • ${t.prescriptionsDispensed ?? 0} روشتة صُرفت`} loading={isLoading} /></Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid xs={12} lg={7}>
          <Section title="الطلبات المفتوحة" action={<Button size="small" component={RouterLink} to="/provider/pharmacy-orders">كل الطلبات</Button>}>
            {lo ? <ListSkeleton rows={3} height={48} /> : open?.items.length ? (
              <Stack divider={<Box sx={{ borderTop: `1px solid ${tokens.line}` }} />}>
                {open.items.map((o) => (
                  <Stack key={o.id} component={RouterLink} to={`/provider/pharmacy-orders/${o.id}`} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1, color: 'inherit', textDecoration: 'none' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600 }} noWrap>{o.patientName} <Typography component="span" variant="caption" color="text.secondary">• {fmtRelative(o.createdAt)}</Typography></Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div" dir="auto">{o.summary || 'تسعير روشتة'}</Typography>
                    </Box>
                    {o.hasPrescription && <Chip size="small" variant="outlined" label="روشتة" />}
                    <Chip size="small" variant="outlined" label={FULFILLMENT[o.fulfillment].split(' ')[0]} />
                    <PhStatusChip value={o.status} />
                  </Stack>
                ))}
              </Stack>
            ) : <Typography color="text.secondary">لا توجد طلبات مفتوحة.</Typography>}
          </Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="الأكثر طلباً"><RankBars data={data?.topMedicines} labelKey="name" valueKey="quantity" unit=" عبوة" /></Section>
        </Grid>
        <Grid xs={12} lg={7}>
          <Section title="المبيعات اليومية"><TrendLine data={data?.daily} dataKey="revenue" name="المبيعات" money /></Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="مخزون منخفض" action={<Button size="small" component={RouterLink} to="/provider/inventory?stock=low">إدارة المخزون</Button>}>
            {data?.lowStock?.length ? (
              <Stack spacing={1}>
                {data.lowStock.map((s) => (
                  <Stack key={s.id} direction="row" justifyContent="space-between" sx={{ p: 1, borderRadius: '8px', border: `1px solid ${s.quantity === 0 ? tokens.signal : tokens.line}` }}>
                    <Typography variant="body2" dir="ltr">{s.name}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: s.quantity === 0 ? tokens.signal : tokens.saffron }}>{s.quantity === 0 ? 'نفد' : `${s.quantity} متبقي`}</Typography>
                  </Stack>
                ))}
              </Stack>
            ) : <Typography color="text.secondary">لا توجد أصناف منخفضة.</Typography>}
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="المبيعات حسب الصنف"><RankBars data={data?.topMedicines?.filter((x) => x.revenue > 0)} labelKey="name" valueKey="revenue" unit=" ج.م" /></Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="عدد الطلبات اليومي"><TrendLine data={data?.daily} dataKey="orders" name="الطلبات" /></Section>
        </Grid>
      </Grid>
    </>
  );
}
