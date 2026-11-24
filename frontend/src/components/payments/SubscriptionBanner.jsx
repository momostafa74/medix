import { Link as RouterLink } from 'react-router-dom';
import { Alert, Button } from '@mui/material';
import { daysUntil } from '../../api/payments';
import { useAuth } from '../../auth/AuthProvider';
import { fmtShortDate } from '../../utils/format';

/** Base path of the provider's dashboard (doctors live under /doctor). */
export const subscriptionPath = (user) => (user?.roles?.includes('DOCTOR') ? '/doctor/subscription' : '/provider/subscription');

/** Trial ending / grace period reminder shown above every provider page. */
export function SubscriptionBanner() {
  const { user } = useAuth();
  const s = user?.subscription;
  if (!s?.endsAt || s.blocked) return null;
  const days = daysUntil(s.endsAt);
  if (days > 5) return null;
  const link = (
    <Button color="inherit" size="small" component={RouterLink} to={subscriptionPath(user)}>
      {s.canPay ? 'جدّد الآن' : 'التفاصيل'}
    </Button>
  );
  if (days <= 0) {
    return (
      <Alert severity="error" sx={{ borderRadius: 0 }} action={link}>
        انتهى اشتراكك وأنت الآن في فترة السماح — جدّد قبل إيقاف الحساب وإخفائه عن المرضى.
      </Alert>
    );
  }
  return (
    <Alert severity="warning" sx={{ borderRadius: 0 }} action={link}>
      اشتراكك ينتهي خلال {days === 1 ? 'يوم واحد' : days === 2 ? 'يومين' : `${days} أيام`} ({fmtShortDate(s.endsAt)}).
    </Alert>
  );
}

