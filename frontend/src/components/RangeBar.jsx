import { Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import dayjs from 'dayjs';
import { TZ } from '../utils/format';

const PRESETS = { 7: '7 أيام', 30: '30 يوم', 90: '90 يوم' };

export const rangeFor = (days) => {
  const to = dayjs().tz(TZ);
  return { from: to.subtract(days - 1, 'day').format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') };
};

/** Date-range control used by dashboards and reports. value: { from, to } */
export default function RangeBar({ value, onChange }) {
  const preset = Object.keys(PRESETS).find((d) => {
    const r = rangeFor(Number(d));
    return r.from === value.from && r.to === value.to;
  });
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
      <ToggleButtonGroup size="small" exclusive value={preset || null} onChange={(_, v) => v && onChange(rangeFor(Number(v)))}>
        {Object.entries(PRESETS).map(([k, v]) => (
          <ToggleButton key={k} value={k} sx={{ px: 1.5 }}>
            {v}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <TextField type="date" label="من" size="small" InputLabelProps={{ shrink: true }} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} sx={{ width: 160 }} />
      <TextField type="date" label="إلى" size="small" InputLabelProps={{ shrink: true }} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} sx={{ width: 160 }} />
    </Stack>
  );
}
