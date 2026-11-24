import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../../api/client';
import { ErrorState, PageHeader, Section, StatCard } from '../../components/common';
import RangeBar, { rangeFor } from '../../components/RangeBar';
import { Donut, RankBars, SimpleBars, StackedBars, TrendLine } from '../../components/Charts';
import { fmtMoney } from '../../utils/format';
import { PROVIDER_TYPE } from '../../utils/labels';
import { tokens } from '../../theme';

const STATUS_LABELS = { PENDING: 'بانتظار التأكيد', CONFIRMED: 'مؤكد', CHECKED_IN: 'حضر', IN_PROGRESS: 'جاري', COMPLETED: 'مكتمل', CANCELLED: 'ملغي', NO_SHOW: 'لم يحضر', RESCHEDULED: 'تم تغييره' };

export function useAdminDashboard(range) {
  return useQuery({ queryKey: ['dashboard', 'admin', range], queryFn: () => api.get(`/dashboards/admin${qs(range)}`).then((r) => r.data), placeholderData: keepPreviousData });
}

export default function AdminDashboard() {
  const [range, setRange] = useState(rangeFor(30));
  const { data, isLoading, error, refetch } = useAdminDashboard(range);
  const s = data?.stats || {};
  const c = data?.charts || {};
  return (
    <>
      <PageHeader title="لوحة الإدارة" actions={<RangeBar value={range} onChange={setRange} />} />
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Grid container spacing={2}>
        <Grid xs={6} md={3}><StatCard tone="primary" label="مواعيد اليوم" value={s.todayAppointments ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الإيراد (الفترة)" value={fmtMoney(s.revenue)} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="عمولة المنصة" value={fmtMoney(s.platformCommission)} hint="حسب قواعد العمولة الحالية" loading={isLoading} /></Grid>
        <Grid xs={6} md={3}>
          <StatCard tone="accent" label="بانتظار الاعتماد" value={s.pendingApprovals ?? 0} hint={s.pendingApprovals ? <RouterLink to="/admin/providers?status=PENDING" style={{ color: tokens.petrol }}>مراجعة الطلبات</RouterLink> : 'لا يوجد'} loading={isLoading} />
        </Grid>
        {[
          ['المرضى', s.patients], ['الأطباء', s.doctors], ['المعامل', s.laboratories], ['مراكز الأشعة', s.radiology], ['الصيدليات', s.pharmacies], ['مقدمو خدمة نشطون', s.activeProviders],
          ['مواعيد الفترة', s.appointments], ['مكتملة', s.completedAppointments], ['ملغاة', s.cancelledAppointments], ['المبالغ المستردة', fmtMoney(s.refunds)], ['تسجيلات جديدة', s.newRegistrations], ['مرضى جدد', s.newPatients],
        ].map(([l, v]) => (
          <Grid xs={6} sm={4} md={2} key={l}><StatCard label={l} value={v ?? 0} loading={isLoading} /></Grid>
        ))}
        <Grid xs={12} lg={8}>
          <Section title="المواعيد يومياً"><StackedBars data={c.byDay} keys={[{ key: 'appointments', label: 'مواعيد' }]} /></Section>
        </Grid>
        <Grid xs={12} lg={4}>
          <Section title="حالات المواعيد"><Donut data={c.statusSplit} nameKey="status" valueKey="count" labels={STATUS_LABELS} /></Section>
        </Grid>
        <Grid xs={12} lg={8}>
          <Section title="الإيراد يومياً"><SimpleBars data={c.byDay} xKey="date" yKey="revenue" name="الإيراد (ج.م)" /></Section>
        </Grid>
        <Grid xs={12} lg={4}>
          <Section title="مقدمو الخدمة حسب النوع"><Donut data={c.providersByType} nameKey="type" valueKey="count" labels={PROVIDER_TYPE} /></Section>
        </Grid>
        <Grid xs={12} lg={4}>
          <Section title="التخصصات الأكثر حجزاً"><RankBars data={c.topSpecialties} labelKey="name" valueKey="count" unit=" حجز" /></Section>
        </Grid>
        <Grid xs={12} md={6} lg={4}>
          <Section title="نمو المرضى (12 شهر)"><TrendLine data={c.patientGrowth} xKey="month" dataKey="total" name="إجمالي المرضى" /></Section>
        </Grid>
        <Grid xs={12} md={6} lg={4}>
          <Section title="نمو مقدمي الخدمة (12 شهر)"><TrendLine data={c.providerGrowth} xKey="month" dataKey="total" name="إجمالي مقدمي الخدمة" /></Section>
        </Grid>
      </Grid>
    </>
  );
}

export function AdminReports() {
  const [range, setRange] = useState(rangeFor(30));
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useAdminDashboard(range);
  const s = data?.stats || {};
  const exportCsv = async () => {
    setBusy(true);
    try {
      await downloadFile(`/reports/appointments.csv${qs({ ...range, scope: 'all' })}`, `all-appointments-${range.from}-${range.to}.csv`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="التقارير" subtitle="تقارير المدفوعات والعمولات التفصيلية تأتي مع وحدة المدفوعات." actions={[<RangeBar key="r" value={range} onChange={setRange} />, <Button key="c" variant="contained" disabled={busy} onClick={exportCsv}>تصدير المواعيد CSV</Button>, <Button key="p" variant="outlined" onClick={() => window.print()}>طباعة</Button>]} />
      <Grid container spacing={2}>
        <Grid xs={6} md={3}><StatCard label="المواعيد" value={s.appointments ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الإيراد" value={fmtMoney(s.revenue)} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="العمولة" value={fmtMoney(s.platformCommission)} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="لم يحضر" value={s.noShows ?? 0} loading={isLoading} /></Grid>
        <Grid xs={12}><Section title="المواعيد والإيراد يومياً"><StackedBars data={data?.charts.byDay} keys={[{ key: 'appointments', label: 'مواعيد' }]} /></Section></Grid>
      </Grid>
    </>
  );
}
