import { useState } from 'react';
import { Badge, Box, Button, Divider, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useUnreadCount } from '../api/queries';
import { chatPathFor } from '../api/chat';
import { useAuth } from '../auth/AuthProvider';
import { fmtRelative } from '../utils/format';
import { patientRecordLink } from '../api/payments';
import { homeFor } from '../auth/AuthProvider';
import { subscriptionPath } from './payments/SubscriptionBanner';
import { tokens } from '../theme';

/** Payment notifications open the booking/order they paid for. */
function paymentLink(user, d) {
  const roles = user?.roles || [];
  const patient = !!user?.patientId && !roles.some((r) => r === 'DOCTOR' || /^(LAB|RADIOLOGY|PHARMACY)_/.test(r));
  if (patient) return patientRecordLink(d.entityType, d.entityId) || '/patient/payments';
  const provider = {
    APPOINTMENT: '/doctor/appointments',
    LAB_ORDER: `/provider/orders/${d.entityId}`,
    RADIOLOGY_ORDER: `/provider/bookings/${d.entityId}`,
    PHARMACY_ORDER: `/provider/pharmacy-orders/${d.entityId}`,
  }[d.entityType];
  if (roles.some((r) => ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'ACCOUNTANT'].includes(r))) return '/admin/payments';
  return provider || (roles.includes('DOCTOR') ? '/doctor/earnings' : '/provider/earnings');
}

export default function NotificationsBell({ allHref }) {
  const [anchor, setAnchor] = useState(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: unread } = useUnreadCount(true);
  const { data } = useQuery({
    queryKey: ['notifications', 'latest'],
    queryFn: () => api.get('/notifications?pageSize=6').then((r) => r.data),
    enabled: !!anchor,
  });
  const readAll = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readOne = (n) => {
    if (!n.readAt) api.patch(`/notifications/${n.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
    setAnchor(null);
    if (n.data?.roomId) nav(chatPathFor(user, n.data.roomId));
    else if (n.data?.labOrderId) nav(user?.patientId && !user.roles?.some((r) => r.startsWith('LAB_')) ? `/patient/lab-orders/${n.data.labOrderId}` : `/provider/orders/${n.data.labOrderId}`);
    else if (n.data?.radiologyOrderId) nav(user?.patientId && !user.roles?.some((r) => r.startsWith('RADIOLOGY_')) ? `/patient/radiology/${n.data.radiologyOrderId}` : `/provider/bookings/${n.data.radiologyOrderId}`);
    else if (n.data?.pharmacyOrderId) nav(user?.roles?.some((r) => r.startsWith('PHARMACY_')) ? `/provider/pharmacy-orders/${n.data.pharmacyOrderId}` : `/patient/pharmacy-orders/${n.data.pharmacyOrderId}`);
    else if (n.data?.prescriptionId) nav(user?.roles?.includes('DOCTOR') ? `/doctor/prescriptions/${n.data.prescriptionId}` : `/patient/prescriptions/${n.data.prescriptionId}`);
    else if (n.data?.invoiceId || n.data?.subscription || n.data?.entityType === 'SUBSCRIPTION') nav(subscriptionPath(user));
    else if (n.data?.paymentId) nav(paymentLink(user, n.data));
    else if (n.data?.security || /^(NEW_DEVICE_LOGIN|ACCOUNT_LOCKED|TWO_FACTOR_|FORCE_LOGOUT)/.test(n.type || '')) nav(`/${homeFor(user).split('/')[1]}/settings`);
    else if (allHref) nav(allHref);
  };
  return (
    <>
      <IconButton aria-label="الإشعارات" onClick={(e) => setAnchor(e.currentTarget)}>
        <Badge badgeContent={unread?.count || 0} color="secondary" max={99}>
          <NotificationsOutlined />
        </Badge>
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} PaperProps={{ sx: { width: 360, maxWidth: '92vw' } }}>
        <Box sx={{ px: 2, py: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">الإشعارات</Typography>
          {!!unread?.count && (
            <Button size="small" onClick={() => readAll.mutate()}>
              تعليم الكل كمقروء
            </Button>
          )}
        </Box>
        <Divider />
        {(data?.items || []).length === 0 && (
          <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            لا توجد إشعارات
          </Typography>
        )}
        {(data?.items || []).map((n) => (
          <MenuItem key={n.id} onClick={() => readOne(n)} sx={{ whiteSpace: 'normal', alignItems: 'flex-start', bgcolor: n.readAt ? 'transparent' : tokens.mint, py: 1.25 }}>
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{n.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {n.body}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {fmtRelative(n.createdAt)}
              </Typography>
            </Box>
          </MenuItem>
        ))}
        {allHref && [
          <Divider key="d" />,
          <MenuItem key="all" onClick={() => { setAnchor(null); nav(allHref); }} sx={{ justifyContent: 'center', color: 'primary.main', fontWeight: 600 }}>
            عرض كل الإشعارات
          </MenuItem>,
        ]}
      </Menu>
    </>
  );
}
