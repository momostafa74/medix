import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../../api/client';
import { ErrorState, ListSkeleton, PageHeader, Section, StatCard, StatusChip } from '../../components/common';
import RangeBar, { rangeFor } from '../../components/RangeBar';
import { SimpleBars, StackedBars, TrendLine } from '../../components/Charts';
import { fmtMoney, fmtShortDate, fmtTime } from '../../utils/format';
import { APPOINTMENT_STATUS, APPOINTMENT_TYPE } from '../../utils/labels';
import { tokens } from '../../theme';

export function useDoctorDashboard(range) {
  return useQuery({
    queryKey: ['dashboard', 'doctor', range],
    queryFn: () => api.get(`/dashboards/doctor${qs(range)}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
}

export default function DoctorDashboard() {
  const [range, setRange] = useState(rangeFor(30));
  const { data, isLoading, error, refetch } = useDoctorDashboard(range);
  const s = data?.stats || {};
  return (
    <>
      <PageHeader title="لوحة التحكم" actions={<RangeBar value={range} onChange={setRange} />} />
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Grid container spacing={2}>
        <Grid xs={6} md={3}><StatCard tone="primary" label="مواعيد اليوم" value={s.todayAppointments ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="مواعيد قادمة" value={s.upcomingAppointments ?? 0} hint={s.awaitingConfirmation ? `${s.awaitingConfirmation} بانتظار تأكيدك` : undefined} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الإيراد (الفترة)" value={fmtMoney(s.revenue)} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard tone="accent" label="التقييم" value={s.reviewsCount ? `${s.rating} / 5` : '—'} hint={`${s.reviewsCount ?? 0} تقييم`} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="مكتملة" value={s.completedAppointments ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="ملغاة" value={s.cancelledAppointments ?? 0} hint={`نسبة ${s.cancellationRate ?? 0}%`} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="لم يحضر" value={s.noShows ?? 0} hint={`نسبة ${s.noShowRate ?? 0}%`} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="إجمالي المرضى" value={s.totalPatients ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="مرضى جدد" value={s.newPatients ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={2}><StatCard label="مرضى عائدون" value={s.returningPatients ?? 0} loading={isLoading} /></Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid xs={12} lg={7}>
          <Section title="مواعيد اليوم" action={<Button component={RouterLink} to="/doctor/appointments" size="small">إدارة المواعيد</Button>}>
            {isLoading ? <ListSkeleton rows={3} height={48} /> : data?.today.length ? (
              <Stack divider={<Box sx={{ borderTop: `1px solid ${tokens.line}` }} />}>
                {data.today.map((a) => (
                  <Stack key={a.id} direction="row" spacing={2} alignItems="center" sx={{ py: 1 }}>
                    <Typography sx={{ fontWeight: 700, width: 72, color: tokens.petrol }}>{fmtTime(a.startAt)}</Typography>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>{a.patientName}</Typography>
                      <Typography variant="caption" color="text.secondary">{APPOINTMENT_TYPE[a.type]} • <span dir="ltr">{a.patientPhone}</span></Typography>
                    </Box>
                    <StatusChip value={a.status} map={APPOINTMENT_STATUS} />
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">لا توجد مواعيد اليوم.</Typography>
            )}
          </Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="أحدث التقييمات" action={<Button component={RouterLink} to="/doctor/reviews" size="small">الكل</Button>}>
            {data?.recentReviews.length ? data.recentReviews.map((r) => (
              <Box key={r.id} sx={{ py: 0.75 }}>
                <Typography sx={{ color: tokens.saffron }} aria-label={`${r.rating} من 5`}>{'★'.repeat(r.rating)}<span style={{ color: tokens.line }}>{'★'.repeat(5 - r.rating)}</span></Typography>
                <Typography variant="body2">{r.comment || 'بدون تعليق'} — <Typography component="span" variant="caption" color="text.secondary">{r.patientName}، {fmtShortDate(r.createdAt)}</Typography></Typography>
              </Box>
            )) : <Typography color="text.secondary">لا توجد تقييمات بعد.</Typography>}
          </Section>
        </Grid>
        <Grid xs={12} lg={7}>
          <Section title="المواعيد يومياً">
            <StackedBars data={data?.charts.byDay} keys={[{ key: 'completed', label: 'مكتمل' }, { key: 'scheduled', label: 'مجدول' }, { key: 'cancelled', label: 'ملغي', color: '#7C8B96' }, { key: 'no_show', label: 'لم يحضر', color: tokens.signal }]} />
          </Section>
        </Grid>
        <Grid xs={12} lg={5}>
          <Section title="أكثر الساعات حجزاً">
            <SimpleBars data={(data?.charts.popularHours || []).map((h) => ({ ...h, label: `${h.hour % 12 || 12}${h.hour < 12 ? 'ص' : 'م'}` }))} xKey="label" yKey="count" name="مواعيد" color={tokens.saffron} />
          </Section>
        </Grid>
        <Grid xs={12}>
          <Section title="الإيراد يومياً">
            <SimpleBars data={data?.charts.byDay} xKey="date" yKey="revenue" name="الإيراد (ج.م)" />
          </Section>
        </Grid>
      </Grid>
    </>
  );
}

export function DoctorReports() {
  const [range, setRange] = useState(rangeFor(30));
  const { data, isLoading } = useDoctorDashboard(range);
  const [busy, setBusy] = useState(false);
  const s = data?.stats || {};
  const exportCsv = async () => {
    setBusy(true);
    try {
      await downloadFile(`/reports/appointments.csv${qs({ ...range, scope: 'provider' })}`, `appointments-${range.from}-${range.to}.csv`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="التقارير" actions={[<RangeBar key="r" value={range} onChange={setRange} />, <Button key="e" variant="contained" onClick={exportCsv} disabled={busy}>تصدير CSV</Button>, <Button key="p" variant="outlined" onClick={() => window.print()}>طباعة</Button>]} />
      <Grid container spacing={2}>
        <Grid xs={6} md={3}><StatCard label="إجمالي المواعيد" value={s.appointments ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="الإيراد" value={fmtMoney(s.revenue)} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="نسبة الإلغاء" value={`${s.cancellationRate ?? 0}%`} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="نسبة عدم الحضور" value={`${s.noShowRate ?? 0}%`} loading={isLoading} /></Grid>
        <Grid xs={12} md={6}>
          <Section title="شهرياً — آخر 12 شهر">
            <SimpleBars data={data?.charts.monthly} xKey="month" yKey="appointments" name="مواعيد" />
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="الإيراد الشهري">
            <TrendLine data={data?.charts.monthly} xKey="month" dataKey="revenue" name="الإيراد" money />
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="المرضى الجدد مقابل العائدين">
            <SimpleBars data={[{ k: 'جدد', v: s.newPatients ?? 0 }, { k: 'عائدون', v: s.returningPatients ?? 0 }]} xKey="k" yKey="v" name="مرضى" color={tokens.saffron} />
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="أكثر الساعات حجزاً">
            <SimpleBars data={(data?.charts.popularHours || []).map((h) => ({ ...h, label: `${h.hour % 12 || 12}${h.hour < 12 ? 'ص' : 'م'}` }))} xKey="label" yKey="count" name="مواعيد" />
          </Section>
        </Grid>
      </Grid>
    </>
  );
}
