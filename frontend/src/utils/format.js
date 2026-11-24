import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ar';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.locale('ar');

/** All clinic times are shown in the clinic timezone, not the browser's. */
export const TZ = 'Africa/Cairo';
export const inTz = (d) => dayjs(d).tz(TZ);

const ARABIC_DIGITS = false; // keep Latin digits for readability of times/prices

export const fmtDate = (d) => (d ? inTz(d).format('dddd D MMMM YYYY') : '—');
export const fmtShortDate = (d) => (d ? inTz(d).format('D MMM YYYY') : '—');
export const fmtTime = (d) => (d ? inTz(d).format('h:mm A').replace('AM', 'ص').replace('PM', 'م') : '—');
export const fmtDateTime = (d) => (d ? `${fmtShortDate(d)} • ${fmtTime(d)}` : '—');
export const fmtRelative = (d) => (d ? dayjs(d).fromNow() : '');
export const fmtHHmm = (hhmm) => {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 && h < 24 ? 'م' : 'ص';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};
export const fmtMoney = (n) =>
  n === null || n === undefined ? '—' : `${Number(n).toLocaleString(ARABIC_DIGITS ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 })} ج.م`;
export const todayISO = () => dayjs().tz(TZ).format('YYYY-MM-DD');
export const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const ageFrom = (dob) => (dob ? dayjs().diff(dayjs(dob), 'year') : null);
