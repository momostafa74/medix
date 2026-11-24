import { useMemo, useState } from 'react';
import { Box, ButtonBase, IconButton, Skeleton, Stack, Typography } from '@mui/material';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { inTz, TZ } from '../utils/format';
import { tokens } from '../theme';
import { ErrorState } from './common';

const WINDOW = 7;

/**
 * The booking moment: a strip of days, each a "ticket" with the open count, and the
 * chosen day's times as tear-off stubs. Booked times stay visible but struck through
 * so patients understand the doctor's day, not just what's left.
 */
export default function SlotPicker({ doctorId, type = 'CLINIC', value, onChange, horizonDays = 30 }) {
  const [offset, setOffset] = useState(0);
  const from = dayjs().tz(TZ).add(offset, 'day').format('YYYY-MM-DD');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['availability', doctorId, type, from],
    queryFn: () => api.get(`/doctors/${doctorId}/availability?from=${from}&days=${WINDOW}&type=${type}`).then((r) => r.data),
    enabled: !!doctorId,
    staleTime: 15_000,
  });
  const days = useMemo(() => data?.days || [], [data]);
  const firstOpen = useMemo(() => days.find((d) => d.slots.some((s) => s.available))?.date, [days]);
  const [picked, setPicked] = useState(null);
  const activeDate = picked && days.some((d) => d.date === picked) ? picked : firstOpen || days[0]?.date;
  const active = days.find((d) => d.date === activeDate);

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <IconButton aria-label="الأيام السابقة" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - WINDOW))}>
          <ChevronRight />
        </IconButton>
        <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: { xs: 'repeat(4, minmax(0,1fr))', sm: `repeat(${WINDOW}, minmax(0,1fr))` }, gap: 0.75, overflow: 'hidden' }}>
          {isLoading
            ? Array.from({ length: WINDOW }).map((_, i) => <Skeleton key={i} variant="rounded" height={74} />)
            : days.map((d, i) => {
                const open = d.slots.filter((s) => s.available).length;
                const selected = d.date === activeDate;
                const dj = dayjs.tz(d.date, TZ);
                return (
                  <ButtonBase
                    key={d.date}
                    onClick={() => setPicked(d.date)}
                    disabled={open === 0}
                    aria-pressed={selected}
                    sx={{
                      display: { xs: i > 3 ? 'none' : 'flex', sm: 'flex' },
                      flexDirection: 'column',
                      py: 1,
                      borderRadius: '10px',
                      border: `1.5px solid ${selected ? tokens.petrol : tokens.line}`,
                      bgcolor: selected ? tokens.petrol : '#fff',
                      color: selected ? '#fff' : open ? tokens.ink : tokens.inkSoft,
                      opacity: open ? 1 : 0.55,
                      transition: 'background-color .15s',
                    }}
                  >
                    <Typography sx={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                      {offset === 0 && i === 0 ? 'اليوم' : offset === 0 && i === 1 ? 'غداً' : dj.format('ddd')}
                    </Typography>
                    <Typography sx={{ fontWeight: 700, fontSize: 20, lineHeight: 1.2 }}>{dj.format('D')}</Typography>
                    <Typography sx={{ fontSize: 11, lineHeight: 1.3, opacity: 0.8, whiteSpace: 'nowrap' }}>{dj.format('MMM')}</Typography>
                    <Typography sx={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'nowrap', color: selected ? tokens.saffron : open ? tokens.success : 'inherit', fontWeight: 600 }}>
                      {d.dayOff ? 'إجازة' : open ? `${open} متاح` : '—'}
                    </Typography>
                  </ButtonBase>
                );
              })}
        </Box>
        <IconButton aria-label="الأيام التالية" disabled={offset + WINDOW >= horizonDays} onClick={() => setOffset((o) => o + WINDOW)}>
          <ChevronLeft />
        </IconButton>
      </Stack>

      <Box sx={{ mt: 2, minHeight: 64 }}>
        {!isLoading && active && active.slots.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            {active.dayOff ? 'الطبيب في إجازة هذا اليوم' : 'لا توجد مواعيد في هذا اليوم، جرّب يوماً آخر'}
          </Typography>
        )}
        {!isLoading && !firstOpen && days.length > 0 && (
          <Typography color="text.secondary" sx={{ pb: 1, textAlign: 'center' }}>
            لا توجد مواعيد متاحة في هذا الأسبوع — اضغط السهم لعرض الأسبوع التالي
          </Typography>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 1 }}>
          {active?.slots.map((s) => {
            const selected = value?.startAt === s.startAt;
            return (
              <ButtonBase
                key={s.startAt}
                disabled={!s.available}
                onClick={() => onChange(s)}
                aria-pressed={selected}
                aria-label={`${inTz(s.startAt).format('h:mm A')}${s.available ? '' : ' غير متاح'}`}
                sx={{
                  position: 'relative',
                  py: 1.1,
                  borderRadius: '999px',
                  fontWeight: 600,
                  fontSize: 15,
                  border: `1.5px dashed ${selected ? tokens.saffron : s.available ? tokens.petrol : tokens.line}`,
                  bgcolor: selected ? tokens.saffron : s.available ? tokens.mint : 'transparent',
                  color: selected ? tokens.ink : s.available ? tokens.petrol : tokens.inkSoft,
                  textDecoration: s.available ? 'none' : 'line-through',
                }}
              >
                {inTz(s.startAt).format('h:mm')}
                <Box component="span" sx={{ fontSize: 12, marginInlineStart: '4px', fontWeight: 500 }}>
                  {inTz(s.startAt).hour() < 12 ? 'ص' : 'م'}
                </Box>
              </ButtonBase>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
