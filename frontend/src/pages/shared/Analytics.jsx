import { useState } from 'react';
import { Box, Button, Card, Chip, CircularProgress, InputAdornment, MenuItem, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import TableChartOutlined from '@mui/icons-material/TableChartOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import { useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, downloadFile, errorMessage, qs } from '../../api/client';
import DataTable from '../../components/DataTable';
import RangeBar, { rangeFor } from '../../components/RangeBar';
import { CompareLine, Donut, RankBars, StackedBars } from '../../components/Charts';
import { ErrorState, PageHeader, Section, useDebounced } from '../../components/common';
import { fmtMoney } from '../../utils/format';
import { PROVIDER_TYPE } from '../../utils/labels';
import { tokens } from '../../theme';

const get = (url) => api.get(url).then((r) => r.data);

const KIND = { APPOINTMENT: 'كشوفات', LAB_ORDER: 'تحاليل', RADIOLOGY_ORDER: 'أشعة', PHARMACY_ORDER: 'صيدلية' };
const CHANNEL = { CLINIC: 'في العيادة', ONLINE: 'أونلاين', HOME: 'منزلي', BRANCH: 'في الفرع', DELIVERY: 'توصيل', PICKUP: 'استلام' };
const METHOD = { CASH: 'نقدي', CARD: 'بطاقة', ONLINE: 'أونلاين', WALLET: 'محفظة' };
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const GENDER = { MALE: 'ذكور', FEMALE: 'إناث', unknown: 'غير محدد' };
const MONEY = ['gmv', 'avgOrderValue', 'refunds', 'discounts', 'commission', 'netRevenue', 'subscriptions', 'platformRevenue'];
const LOWER_IS_BETTER = ['cancelled', 'noShow', 'cancellationRate', 'noShowRate', 'refunds'];

const fmtKpi = (k, v) => (v == null ? '—' : MONEY.includes(k) ? fmtMoney(Math.round(v)) : /Rate|Share/.test(k) ? `${v}%` : k === 'rating' ? (v ? `${v} / 5` : '—') : Number(v).toLocaleString('en-US'));

function Kpi({ k, label, ov, primary }) {
  const v = ov?.current?.[k];
  const ch = ov?.change?.[k];
  const prev = ov?.previous?.[k];
  const good = ch == null || ch === 0 ? null : ch > 0 !== LOWER_IS_BETTER.includes(k);
  return (
    <Card sx={{ p: 2, height: '100%', bgcolor: primary ? tokens.petrol : undefined, color: primary ? '#fff' : undefined }}>
      <Typography variant="body2" sx={{ opacity: 0.85 }}>{label}</Typography>
      <Typography sx={{ fontSize: { xs: 20, md: 22 }, fontWeight: 800, lineHeight: 1.3, my: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={fmtKpi(k, v)}>
        {fmtKpi(k, v)}
      </Typography>
      {ov?.previous && (
        <Tooltip title={`الفترة السابقة: ${fmtKpi(k, prev)}`}>
          <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
            <Box
              component="span"
              sx={{ fontSize: 12, fontWeight: 700, px: 0.75, borderRadius: 1, whiteSpace: 'nowrap', color: good == null ? 'inherit' : good ? tokens.success : tokens.signal, bgcolor: primary ? 'rgba(255,255,255,.9)' : 'action.hover' }}
            >
              {ch == null ? 'جديد' : `${ch > 0 ? '▲' : ch < 0 ? '▼' : '•'} ${Math.abs(ch)}%`}
            </Box>
            <Typography variant="caption" sx={{ opacity: 0.75 }}>مقابل {fmtKpi(k, prev)}</Typography>
          </Stack>
        </Tooltip>
      )}
    </Card>
  );
}

/** Weekday × hour grid of how busy the service times are. */
function Heatmap({ cells }) {
  const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7 am → 10 pm
  const map = new Map((cells || []).map((c) => [`${c.dow}-${c.hour}`, c.n]));
  const max = Math.max(1, ...(cells || []).map((c) => c.n));
  if (!cells?.length) return <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>لا توجد بيانات في هذه الفترة</Typography>;
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 11, minWidth: 560 }}>
        <thead>
          <tr>
            <th />
            {hours.map((h) => <Box component="th" key={h} sx={{ fontWeight: 500, color: 'text.secondary' }}>{h % 12 || 12}{h < 12 ? 'ص' : 'م'}</Box>)}
          </tr>
        </thead>
        <tbody>
          {[6, 0, 1, 2, 3, 4, 5].map((d) => (
            <tr key={d}>
              <Box component="th" sx={{ fontWeight: 500, textAlign: 'right', pl: 1, color: 'text.secondary', whiteSpace: 'nowrap' }}>{DAYS[d]}</Box>
              {hours.map((h) => {
                const n = map.get(`${d}-${h}`) || 0;
                return (
                  <Tooltip key={h} title={`${DAYS[d]} ${h}:00 — ${n} حجز`}>
                    <Box component="td" sx={{ width: 26, height: 22, borderRadius: 1, bgcolor: n ? tokens.petrol : tokens.paper, opacity: n ? 0.15 + 0.85 * (n / max) : 1 }} />
                  </Tooltip>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function Cohorts({ data }) {
  if (!data?.cohorts?.length) return <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>لا توجد بيانات كافية بعد</Typography>;
  const n = data.cohorts[0].retention.length;
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 13, width: '100%' }}>
        <thead>
          <tr>
            <Box component="th" sx={{ textAlign: 'right', color: 'text.secondary', fontWeight: 500 }}>شهر أول حجز</Box>
            <Box component="th" sx={{ color: 'text.secondary', fontWeight: 500 }}>مرضى</Box>
            {Array.from({ length: n }, (_, i) => <Box component="th" key={i} sx={{ color: 'text.secondary', fontWeight: 500 }}>بعد {i + 1} شهر</Box>)}
          </tr>
        </thead>
        <tbody>
          {data.cohorts.map((c) => (
            <tr key={c.cohort}>
              <Box component="td" sx={{ whiteSpace: 'nowrap' }}>{new Date(c.cohort).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}</Box>
              <Box component="td" sx={{ textAlign: 'center', fontWeight: 700 }}>{c.size}</Box>
              {c.retention.map((v, i) => (
                <Box component="td" key={i} sx={{ textAlign: 'center', borderRadius: 1, py: 0.75, minWidth: 64, bgcolor: v == null ? 'transparent' : `rgba(15,76,92,${0.08 + (v / 100) * 0.8})`, color: v != null && v > 45 ? '#fff' : 'inherit' }}>
                  {v == null ? '' : `${v}%`}
                </Box>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
      <Typography variant="caption" color="text.secondary">نسبة المرضى من كل شهر اللي رجعوا وحجزوا تاني بعد شهر، شهرين…</Typography>
    </Box>
  );
}

function Funnel({ steps }) {
  return (
    <Stack spacing={1}>
      {(steps || []).map((s) => (
        <Box key={s.key}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" fontWeight={600}>{s.label}</Typography>
            <Typography variant="body2" color="text.secondary">{s.count} • {s.pctOfFirst}%</Typography>
          </Stack>
          <Box sx={{ height: 10, borderRadius: 5, bgcolor: tokens.paper }}>
            <Box sx={{ height: 10, borderRadius: 5, bgcolor: tokens.petrol, width: `${s.pctOfFirst}%` }} />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function Leaderboard({ range }) {
  const [type, setType] = useState('');
  const [sort, setSort] = useState('gmv');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const params = { ...range, type, sort, search, page, pageSize: 15 };
  const { data, isLoading } = useQuery({ queryKey: ['analytics', 'providers', params], queryFn: () => get(`/analytics/providers${qs(params)}`), placeholderData: (p) => p });
  const head = (key, label) => (
    <Box component="span" onClick={() => { setSort(key); setPage(1); }} sx={{ cursor: 'pointer', fontWeight: sort === key ? 800 : undefined, textDecoration: sort === key ? 'underline' : undefined }}>
      {label}
    </Box>
  );
  return (
    <Section title="أداء مقدمي الخدمة">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
        <TextField size="small" placeholder="بحث بالاسم" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
        <TextField select size="small" label="النوع" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} sx={{ minWidth: 150 }}>
          <MenuItem value="">الكل</MenuItem>
          {['DOCTOR', 'LABORATORY', 'RADIOLOGY', 'PHARMACY'].map((k) => <MenuItem key={k} value={k}>{PROVIDER_TYPE[k]}</MenuItem>)}
        </TextField>
      </Stack>
      <DataTable
        dense
        loading={isLoading}
        rows={(data?.items || []).map((r) => ({ ...r, id: r.providerId }))}
        total={data?.total || 0}
        page={page}
        pageSize={15}
        onPageChange={setPage}
        columns={[
          { key: 'nameAr', label: 'مقدم الخدمة', render: (r) => <Stack><span>{r.nameAr}</span><Typography variant="caption" color="text.secondary">{PROVIDER_TYPE[r.type]}{!r.subscriptionActive ? ' • اشتراك منتهي' : ''}</Typography></Stack> },
          { key: 'bookings', label: head('bookings', 'حجوزات'), nowrap: true },
          { key: 'completionRate', label: head('completionRate', 'الاكتمال'), nowrap: true, render: (r) => `${r.completionRate}%` },
          { key: 'cancellationRate', label: head('cancellationRate', 'الإلغاء'), nowrap: true, render: (r) => <Box component="span" sx={{ color: r.cancellationRate >= 15 ? 'error.main' : undefined }}>{r.cancellationRate}%</Box> },
          { key: 'patients', label: head('patients', 'مرضى'), nowrap: true },
          { key: 'gmv', label: head('gmv', 'المدفوعات'), nowrap: true, render: (r) => fmtMoney(r.gmv) },
          { key: 'commission', label: head('commission', 'العمولة'), nowrap: true, render: (r) => fmtMoney(r.commission) },
          { key: 'rating', label: head('rating', 'التقييم'), nowrap: true, render: (r) => (r.reviews ? `${r.rating} (${r.reviews})` : '—') },
        ]}
      />
    </Section>
  );
}

/**
 * Analytics for the whole platform (scope="admin", /api/analytics) or for the signed-in
 * provider (scope="provider", /api/analytics/provider).
 */
export default function AnalyticsPage({ scope = 'admin' }) {
  const base = scope === 'admin' ? '/analytics' : '/analytics/provider';
  const [range, setRange] = useState(rangeFor(30));
  const [compare, setCompare] = useState('previous');
  const [metric, setMetric] = useState('bookings');
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState('');
  const { enqueueSnackbar } = useSnackbar();
  const p = { ...range, compare };
  const ov = useQuery({ queryKey: ['analytics', scope, 'overview', p], queryFn: () => get(`${base}/overview${qs(p)}`) });
  const ts = useQuery({ queryKey: ['analytics', scope, 'ts', p], queryFn: () => get(`${base}/timeseries${qs({ ...p, compare: compare === 'none' ? 'none' : compare })}`) });
  const bd = useQuery({ queryKey: ['analytics', scope, 'bd', range], queryFn: () => get(`${base}/breakdowns${qs(range)}`) });
  const fn = useQuery({ queryKey: ['analytics', scope, 'funnel', range], queryFn: () => get(`${base}/funnel${qs(range)}`), enabled: tab === 'patients' });
  const co = useQuery({ queryKey: ['analytics', scope, 'cohorts'], queryFn: () => get(`${base}/cohorts?months=6`), enabled: tab === 'patients' });
  const o = ov.data;
  const admin = scope === 'admin';

  const download = async (kind) => {
    setBusy(kind);
    try {
      await downloadFile(`${base}/${kind === 'xlsx' ? 'export.xlsx' : 'report.pdf'}${qs(p)}`, `medix-${admin ? 'analytics' : 'report'}-${range.from}-${range.to}.${kind}`);
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy('');
    }
  };

  const kpis = admin
    ? [
        ['platformRevenue', 'إيراد المنصة', true],
        ['gmv', 'إجمالي المدفوعات'],
        ['bookings', 'الحجوزات والطلبات'],
        ['completionRate', 'نسبة الاكتمال'],
        ['activePatients', 'مرضى نشطون'],
        ['newPatients', 'مرضى جدد'],
        ['repeatRate', 'نسبة العودة'],
        ['cancellationRate', 'نسبة الإلغاء'],
        ['avgOrderValue', 'متوسط قيمة العملية'],
        ['onlineShare', 'الدفع الأونلاين'],
        ['activeProviders', 'مقدمو خدمة نشطون'],
        ['rating', 'متوسط التقييم'],
      ]
    : [
        ['netRevenue', 'صافي إيرادك', true],
        ['gmv', 'إجمالي المدفوعات'],
        ['bookings', 'الحجوزات والطلبات'],
        ['completionRate', 'نسبة الاكتمال'],
        ['activePatients', 'مرضى خدمتهم'],
        ['newPatients', 'مرضى جدد'],
        ['repeatRate', 'نسبة العودة'],
        ['cancellationRate', 'نسبة الإلغاء'],
        ['noShowRate', 'عدم الحضور'],
        ['avgOrderValue', 'متوسط قيمة العملية'],
        ['rating', 'التقييم في الفترة'],
        ['discounts', 'خصومات الكوبونات'],
      ];

  const series = ts.data?.series || [];
  const metricCfg = {
    bookings: { key: 'bookings', prev: 'previousBookings', name: 'الحجوزات' },
    gmv: { key: 'gmv', prev: 'previousGmv', name: 'المدفوعات', money: true },
    revenue: admin ? { key: 'platformRevenue', name: 'إيراد المنصة', money: true } : { key: 'net', name: 'صافي الإيراد', money: true },
  }[metric];
  const genders = Object.entries(bd.data?.patients?.gender || {}).map(([k, v]) => ({ key: k, value: v }));
  const ages = Object.entries(bd.data?.patients?.ageGroups || {}).filter(([k]) => k !== 'unknown').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ name: k === '60+' ? '60+ سنة' : `${k} سنة`, value: v }));

  return (
    <>
      <PageHeader
        title={admin ? 'التحليلات' : 'تحليلات الأداء'}
        subtitle={admin ? 'كل مؤشرات المنصة مع المقارنة بالفترة السابقة — الحجوزات، المرضى، الإيراد، ومقدمو الخدمة.' : 'أداؤك مقارنة بالفترة السابقة: الحجوزات، المرضى، الإيراد، وأوقات الذروة.'}
      />
      <Card sx={{ p: 1.5, mb: 2 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ lg: 'center' }} justifyContent="space-between">
          <RangeBar value={range} onChange={setRange} />
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <TextField select size="small" label="المقارنة" value={compare} onChange={(e) => setCompare(e.target.value)} sx={{ width: 210 }}>
              <MenuItem value="previous">الفترة السابقة</MenuItem>
              <MenuItem value="year">نفس الفترة العام الماضي</MenuItem>
              <MenuItem value="none">بدون مقارنة</MenuItem>
            </TextField>
            <Button variant="outlined" startIcon={busy === 'xlsx' ? <CircularProgress size={16} /> : <TableChartOutlined />} onClick={() => download('xlsx')} disabled={!!busy}>Excel</Button>
            <Button variant="outlined" startIcon={busy === 'pdf' ? <CircularProgress size={16} /> : <PictureAsPdfOutlined />} onClick={() => download('pdf')} disabled={!!busy}>تقرير PDF</Button>
          </Stack>
        </Stack>
      </Card>
      {ov.error && <ErrorState error={ov.error} onRetry={ov.refetch} />}
      {o?.compareRange && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {o.range.from} ← {o.range.to} مقارنة بـ {o.compareRange.from} ← {o.compareRange.to}
        </Typography>
      )}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {kpis.map(([k, label, primary]) => (
          <Grid key={k} xs={6} sm={4} md={3} xl={2}>
            {ov.isLoading ? <Card sx={{ p: 2, height: 108 }} /> : <Kpi k={k} label={label} ov={o} primary={primary} />}
          </Grid>
        ))}
      </Grid>

      <Card sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
          <Tab value="overview" label="الاتجاه والخدمات" />
          <Tab value="patients" label="المرضى والعودة" />
          <Tab value="time" label="أوقات الذروة والأماكن" />
          {admin && <Tab value="providers" label="مقدمو الخدمة" />}
        </Tabs>
      </Card>

      {tab === 'overview' && (
        <Grid container spacing={2}>
          <Grid xs={12}>
            <Section
              title={`الاتجاه (${{ day: 'يومي', week: 'أسبوعي', month: 'شهري' }[ts.data?.granularity] || ''})`}
              action={
                <ToggleButtonGroup size="small" exclusive value={metric} onChange={(_, v) => v && setMetric(v)}>
                  <ToggleButton value="bookings">الحجوزات</ToggleButton>
                  <ToggleButton value="gmv">المدفوعات</ToggleButton>
                  <ToggleButton value="revenue">{admin ? 'إيراد المنصة' : 'صافيك'}</ToggleButton>
                </ToggleButtonGroup>
              }
            >
              <CompareLine data={series} dataKey={metricCfg.key} previousKey={compare !== 'none' ? metricCfg.prev : undefined} name={metricCfg.name} previousName={compare === 'year' ? 'العام الماضي' : 'الفترة السابقة'} money={metricCfg.money} />
            </Section>
          </Grid>
          <Grid xs={12} md={7}>
            <Section title="الحجوزات حسب الخدمة">
              <StackedBars
                data={series}
                xKey="bucket"
                keys={[
                  { key: 'appointments', label: 'كشوفات' },
                  { key: 'lab', label: 'تحاليل' },
                  { key: 'radiology', label: 'أشعة' },
                  { key: 'pharmacy', label: 'صيدلية' },
                ]}
              />
            </Section>
          </Grid>
          <Grid xs={12} md={5}>
            <Section title="مزيج الخدمات">
              {(bd.data?.byKind || []).map((r) => (
                <Stack key={r.key} direction="row" justifyContent="space-between" sx={{ py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography fontWeight={600}>{KIND[r.key]}</Typography>
                  <Typography variant="body2" color="text.secondary">{r.bookings} حجز • {r.completed} مكتمل • {fmtMoney(r.value)}</Typography>
                </Stack>
              ))}
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>طرق الخدمة</Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {(bd.data?.byChannel || []).map((r) => <Chip key={`${r.kind}-${r.key}`} size="small" label={`${KIND[r.kind]} — ${CHANNEL[r.key] || r.key}: ${r.bookings}`} />)}
              </Stack>
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>طرق الدفع</Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {(bd.data?.byPaymentMethod || []).map((r) => <Chip key={`${r.key}-${r.collected_by}`} size="small" variant="outlined" label={`${METHOD[r.key] || r.key}: ${fmtMoney(r.value)}`} />)}
              </Stack>
            </Section>
          </Grid>
          {bd.data?.bySpecialty?.length > 0 && (
            <Grid xs={12} md={6}>
              <Section title="الكشوفات حسب التخصص">
                <RankBars data={bd.data.bySpecialty.slice(0, 8)} labelKey="key" valueKey="bookings" unit=" كشف" />
              </Section>
            </Grid>
          )}
          {bd.data?.topItems?.length > 0 && (
            <Grid xs={12} md={6}>
              <Section title="الأكثر طلباً">
                <RankBars data={bd.data.topItems.map((x) => ({ ...x, value: Math.round(x.value) }))} labelKey="name" valueKey="value" unit=" ج.م" />
              </Section>
            </Grid>
          )}
        </Grid>
      )}

      {tab === 'patients' && (
        <Grid container spacing={2}>
          <Grid xs={12} md={6}>
            <Section title="رحلة الكشف">
              <Funnel steps={fn.data?.appointments} />
            </Section>
          </Grid>
          <Grid xs={12} md={6}>
            <Section title="رحلة الطلبات (تحاليل، أشعة، صيدلية)">
              <Funnel steps={fn.data?.orders} />
            </Section>
          </Grid>
          <Grid xs={12}>
            <Section title="عودة المرضى (Cohorts)">
              <Cohorts data={co.data} />
            </Section>
          </Grid>
          <Grid xs={12} md={6}>
            <Section title="المرضى حسب النوع">
              <Donut data={genders} nameKey="key" valueKey="value" labels={GENDER} />
            </Section>
          </Grid>
          <Grid xs={12} md={6}>
            <Section title="المرضى حسب السن">
              <RankBars data={ages} labelKey="name" valueKey="value" unit=" مريض" />
            </Section>
          </Grid>
        </Grid>
      )}

      {tab === 'time' && (
        <Grid container spacing={2}>
          <Grid xs={12} lg={8}>
            <Section title="أوقات الذروة (حسب موعد الخدمة)">
              <Heatmap cells={bd.data?.heatmap} />
            </Section>
          </Grid>
          <Grid xs={12} lg={4}>
            <Section title="حسب المحافظة">
              <RankBars data={bd.data?.byGovernorate || []} labelKey="key" valueKey="bookings" unit=" حجز" />
            </Section>
          </Grid>
        </Grid>
      )}

      {tab === 'providers' && admin && <Leaderboard range={range} />}
    </>
  );
}
