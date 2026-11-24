import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, ButtonBase, Chip, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { FLAG, LAB_STATUS, PATIENT_STAGES } from '../../api/labs';
import { StatusChip } from '../common';
import { api } from '../../api/client';
import { fmtDateTime } from '../../utils/format';
import { tokens } from '../../theme';

export const LabStatusChip = ({ value, size }) => <StatusChip value={value} map={LAB_STATUS} size={size} />;

export function FlagChip({ flag }) {
  if (!flag) return null;
  const f = FLAG[flag];
  if (flag === 'NORMAL') return <Typography component="span" sx={{ color: tokens.success, fontSize: 13, fontWeight: 600 }}>طبيعي</Typography>;
  return (
    <Chip
      size="small"
      label={`${flag === 'HIGH' ? '▲ ' : flag === 'LOW' ? '▼ ' : '! '}${f.label}`}
      sx={{
        fontWeight: 700,
        bgcolor: flag === 'CRITICAL' ? tokens.signal : tokens.saffronSoft,
        color: flag === 'CRITICAL' ? '#fff' : '#8A5A00',
      }}
    />
  );
}

/** Parses "70 – 100", "< 200", "> 40" into numbers (null when the range is textual). */
export function parseRange(ref) {
  if (!ref) return null;
  const nums = ref.match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
  if (/^\s*</.test(ref) && nums.length === 1) return { low: null, high: nums[0] };
  if (/^\s*>/.test(ref) && nums.length === 1) return { low: nums[0], high: null };
  if (nums.length === 2) return { low: nums[0], high: nums[1] };
  return null;
}

/**
 * Where the value sits relative to the normal band — the visual a patient can read
 * at a glance. Numbers always run left→right, even in RTL.
 */
export function RangeGauge({ value, referenceRange, flag, width = 150 }) {
  const r = parseRange(referenceRange);
  const v = Number(String(value).replace(/[<>≤≥=\s]/g, ''));
  if (!r || Number.isNaN(v)) return null;
  const low = r.low ?? 0;
  const high = r.high ?? (low * 2 || 1);
  const span = high - low || 1;
  const min = Math.min(low - span * 0.6, v);
  const max = Math.max(high + span * 0.6, v);
  const pct = (x) => ((x - min) / (max - min)) * 100;
  const color = flag === 'CRITICAL' ? tokens.signal : flag === 'NORMAL' ? tokens.success : tokens.saffron;
  return (
    <Box dir="ltr" aria-hidden sx={{ position: 'relative', width, height: 14 }}>
      <Box sx={{ position: 'absolute', top: 5, left: 0, right: 0, height: 4, borderRadius: 2, bgcolor: tokens.line }} />
      <Box sx={{ position: 'absolute', top: 5, height: 4, borderRadius: 2, bgcolor: '#A9D6C4', left: `${pct(r.low ?? min)}%`, width: `${pct(r.high ?? max) - pct(r.low ?? min)}%` }} />
      <Box sx={{ position: 'absolute', top: 1, width: 12, height: 12, borderRadius: '50%', bgcolor: color, border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.08)', left: `calc(${Math.min(100, Math.max(0, pct(v)))}% - 6px)` }} />
    </Box>
  );
}

/** Grouped results table used by patients, doctors and the lab. */
export function ResultsTable({ groups, dense }) {
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size={dense ? 'small' : 'medium'} sx={{ minWidth: 560 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: '30%' }}>البند</TableCell>
            <TableCell>النتيجة</TableCell>
            <TableCell>المعدل الطبيعي</TableCell>
            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }} />
            <TableCell>الحالة</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => (
            <Fragment key={g.testId}>
              <TableRow>
                <TableCell colSpan={5} sx={{ bgcolor: tokens.paper, py: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="baseline">
                    <Typography sx={{ fontWeight: 700, color: tokens.petrol }}>{g.name}</Typography>
                    <Typography variant="caption" color="text.secondary" dir="ltr">{g.code}</Typography>
                    {g.packageName && <Typography variant="caption" color="text.secondary">• ضمن {g.packageName}</Typography>}
                  </Stack>
                </TableCell>
              </TableRow>
              {g.items.map((i) => (
                <TableRow key={i.parameterId} sx={{ bgcolor: i.flag === 'CRITICAL' ? '#FBEDEA' : i.flag !== 'NORMAL' ? '#FFF8EC' : undefined }}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }} dir="auto">{i.name}</Typography>
                    {i.notes && <Typography variant="caption" color="text.secondary">{i.notes}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Typography component="span" dir="ltr" sx={{ fontWeight: 700, fontSize: 16 }}>{i.value}</Typography>{' '}
                    <Typography component="span" variant="caption" color="text.secondary" dir="ltr">{i.unit}</Typography>
                  </TableCell>
                  <TableCell><Typography variant="body2" color="text.secondary" dir="ltr" sx={{ textAlign: 'right' }}>{i.referenceRange || '—'}</Typography></TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}><RangeGauge value={i.value} referenceRange={i.referenceRange} flag={i.flag} /></TableCell>
                  <TableCell><FlagChip flag={i.flag} /></TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function CriticalBanner({ count }) {
  if (!count) return null;
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#FBEDEA', color: tokens.signal, border: `1px solid ${tokens.signal}` }}>
      <WarningAmberRounded />
      <Typography sx={{ fontWeight: 600 }}>تحتوي النتيجة على {count === 1 ? 'قيمة حرجة' : `${count} قيم حرجة`} — يرجى مراجعة الطبيب فوراً.</Typography>
    </Stack>
  );
}

/** Patient-facing 4-stage track. */
export function OrderTrack({ status }) {
  if (status === 'CANCELLED') return null;
  const idx = PATIENT_STAGES.findIndex((s) => s.statuses.includes(status));
  return (
    <Stack direction="row" spacing={0} sx={{ my: 1 }}>
      {PATIENT_STAGES.map((s, i) => {
        const done = i <= idx;
        return (
          <Box key={s.label} sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ height: 6, borderRadius: 3, mx: 0.25, bgcolor: done ? (i === idx && idx < 3 ? tokens.saffron : tokens.petrol) : tokens.line }} />
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, textAlign: 'center', fontWeight: i === idx ? 700 : 400, color: done ? tokens.ink : 'text.secondary' }} noWrap>
              {s.label}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

export function HistoryList({ history, labels = LAB_STATUS }) {
  return (
    <Stack spacing={1.25}>
      {history.map((h, i) => (
        <Stack key={i} direction="row" spacing={1.5}>
          <Box sx={{ width: 10, height: 10, mt: 0.75, borderRadius: '50%', bgcolor: i === history.length - 1 ? tokens.saffron : tokens.petrol, flexShrink: 0 }} />
          <Box>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{h.from_status === h.to_status ? 'ملاحظة' : labels[h.to_status]?.label || h.to_status}</Typography>
            <Typography variant="caption" color="text.secondary">
              {fmtDateTime(h.created_at)}
              {h.by_name ? ` • ${h.by_name}` : ''}
            </Typography>
            {h.note && <Typography variant="body2" color="text.secondary">{h.note}</Typography>}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

export function ItemsSummary({ items }) {
  return (
    <Stack spacing={0.75}>
      {items.map((it) => (
        <Stack key={it.id} direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box>
            <Typography sx={{ fontWeight: 600 }}>{it.test ? it.test.name : it.package.name}</Typography>
            {it.package && (
              <Tooltip title={it.package.tests.map((t) => t.name).join('، ')}>
                <Typography variant="caption" color="text.secondary">باقة • {it.package.tests.length} تحاليل</Typography>
              </Tooltip>
            )}
            {it.test?.preparationInstructions && <Typography variant="caption" sx={{ display: 'block', color: '#8A5A00' }}>تحضير: {it.test.preparationInstructions}</Typography>}
          </Box>
          <Typography sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{Number(it.price).toLocaleString('en-US')} ج.م</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** Approved lab results of a patient (medical record tab for the patient, and for providers with a care relationship). */
export function LabResultsHistory({ patientId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['lab-results-history', patientId],
    queryFn: () => api.get(`/patients/${patientId}/lab-results`).then((r) => r.data),
    enabled: !!patientId,
  });
  const [open, setOpen] = useState(null);
  if (error) return <Typography color="text.secondary">{error.response?.status === 403 ? 'لا تملك صلاحية عرض نتائج التحاليل.' : 'تعذر تحميل نتائج التحاليل.'}</Typography>;
  if (isLoading) return <Skeleton variant="rounded" height={120} />;
  if (!data.length) return <Typography color="text.secondary">لا توجد نتائج تحاليل معتمدة.</Typography>;
  return (
    <Stack spacing={1}>
      {data.map((o) => {
        const abnormal = o.groups.reduce((n, g) => n + g.items.filter((i) => i.flag !== 'NORMAL').length, 0);
        const isOpen = open === o.orderId;
        return (
          <Box key={o.orderId} sx={{ borderRadius: '10px', border: `1px solid ${o.criticalCount ? tokens.signal : tokens.line}` }}>
            <ButtonBase onClick={() => setOpen(isOpen ? null : o.orderId)} sx={{ width: '100%', p: 1.5, justifyContent: 'space-between', textAlign: 'right' }}>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>{o.groups.map((g) => g.name).join('، ')}</Typography>
                <Typography variant="caption" color="text.secondary">{o.laboratory.nameAr} • {fmtDateTime(o.approvedAt)}</Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                {o.criticalCount > 0 && <Chip size="small" label="قيم حرجة" sx={{ bgcolor: tokens.signal, color: '#fff' }} />}
                {abnormal > 0 && !o.criticalCount && <Chip size="small" label={`${abnormal} خارج المعدل`} sx={{ bgcolor: tokens.saffronSoft }} />}
                {abnormal === 0 && <Chip size="small" label="كلها طبيعية" variant="outlined" color="success" />}
              </Stack>
            </ButtonBase>
            {isOpen && (
              <Box sx={{ px: 1, pb: 1 }}>
                <ResultsTable groups={o.groups} dense />
                {o.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 1, px: 1 }}>ملاحظات المعمل: {o.notes}</Typography>}
              </Box>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
