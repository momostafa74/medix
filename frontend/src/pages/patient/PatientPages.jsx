import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Avatar, Box, Button, Card, Chip, IconButton, Pagination, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import WhatsApp from '@mui/icons-material/WhatsApp';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import Favorite from '@mui/icons-material/Favorite';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fileUrl, qs } from '../../api/client';
import { PayOnlineButton } from '../../components/payments/PayUi';
import { useAuth } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Section, StatCard, StatusChip } from '../../components/common';
import { CancelDialog, RescheduleDialog, ReviewDialog } from '../../components/AppointmentDialogs';
import { Rating } from '../../components/DoctorCard';
import ChatButton from '../../components/ChatButton';
import { fmtDate, fmtMoney, fmtTime } from '../../utils/format';
import { APPOINTMENT_STATUS, APPOINTMENT_TYPE, PROVIDER_TYPE } from '../../utils/labels';
import { whatsappLink } from '../../utils/whatsapp';
import { tokens } from '../../theme';

export function PatientDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', 'patient'], queryFn: () => api.get('/dashboards/patient').then((r) => r.data) });
  const [review, setReview] = useState(null);
  const s = data?.stats || {};
  return (
    <>
      <PageHeader title={`أهلاً ${user.fullName.split(' ')[0]}`} subtitle="مواعيدك القادمة وكل ما يخص زياراتك" actions={<Button component={RouterLink} to="/doctors" variant="contained">احجز موعد جديد</Button>} />
      <Grid container spacing={2}>
        <Grid xs={6} md={3}><StatCard tone="primary" label="مواعيد قادمة" value={s.upcoming ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="زيارات مكتملة" value={s.completed ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard label="المفضلة" value={s.favorites ?? 0} loading={isLoading} /></Grid>
        <Grid xs={6} md={3}><StatCard tone="accent" label="إشعارات غير مقروءة" value={s.unread ?? 0} loading={isLoading} /></Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid xs={12} md={7}>
          <Section title="المواعيد القادمة" action={<Button component={RouterLink} to="/patient/appointments" size="small">كل المواعيد</Button>}>
            {isLoading ? <ListSkeleton rows={2} /> : data?.upcoming.length ? (
              <Stack spacing={1.5}>
                {data.upcoming.map((a) => (
                  <Box key={a.id} sx={{ p: 1.5, borderRadius: '10px', border: `1px solid ${tokens.line}` }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography sx={{ fontWeight: 600 }}>{a.providerName}</Typography>
                      <StatusChip value={a.status} map={APPOINTMENT_STATUS} />
                    </Stack>
                    <Typography>{fmtDate(a.startAt)} — {fmtTime(a.startAt)}</Typography>
                    {a.branchName && <Typography variant="body2" color="text.secondary">{a.branchName} • {a.address}</Typography>}
                  </Box>
                ))}
              </Stack>
            ) : (
              <EmptyState title="لا توجد مواعيد قادمة" action={<Button component={RouterLink} to="/doctors" variant="outlined">ابحث عن طبيب</Button>} />
            )}
          </Section>
        </Grid>
        <Grid xs={12} md={5}>
          <Section title="قيّم زياراتك">
            {data?.toReview.length ? (
              <Stack spacing={1}>
                {data.toReview.map((a) => (
                  <Stack key={a.id} direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography sx={{ fontWeight: 600 }}>{a.providerName}</Typography>
                      <Typography variant="caption" color="text.secondary">{fmtDate(a.startAt)}</Typography>
                    </Box>
                    <Button size="small" variant="outlined" onClick={() => setReview({ id: a.id, provider: { nameAr: a.providerName } })}>قيّم</Button>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">لا توجد زيارات بانتظار التقييم.</Typography>
            )}
          </Section>
          <Section title="سجلك الطبي" sx={{ mt: 2 }}>
            <Typography color="text.secondary" sx={{ mb: 1.5 }}>سجّل الحساسية والأمراض المزمنة والأدوية — يراها فقط الأطباء الذين تحجز معهم.</Typography>
            <Button component={RouterLink} to="/patient/medical-record" variant="outlined">فتح السجل الطبي</Button>
          </Section>
        </Grid>
      </Grid>
      <ReviewDialog appointment={review} onClose={() => setReview(null)} />
    </>
  );
}

const TABS = { upcoming: 'القادمة', past: 'السابقة', cancelled: 'الملغاة' };

export function PatientAppointments() {
  const [tab, setTab] = useState('upcoming');
  const [page, setPage] = useState(1);
  const [cancel, setCancel] = useState(null);
  const [resched, setResched] = useState(null);
  const [review, setReview] = useState(null);
  const params =
    tab === 'cancelled'
      ? { status: ['CANCELLED', 'RESCHEDULED'] }
      : tab === 'upcoming'
        ? { when: 'upcoming', status: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] }
        : { when: 'past', status: ['COMPLETED', 'NO_SHOW', 'CONFIRMED', 'PENDING'] };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['appointments', 'patient', tab, page],
    queryFn: () => api.get(`/appointments${qs({ scope: 'patient', ...params, page, pageSize: 10, sortDir: tab === 'upcoming' ? 'asc' : 'desc' })}`).then((r) => r.data),
  });
  return (
    <>
      <PageHeader title="مواعيدي" actions={<Button component={RouterLink} to="/doctors" variant="contained">حجز جديد</Button>} />
      <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(1); }} sx={{ mb: 2 }}>
        {Object.entries(TABS).map(([k, v]) => <Tab key={k} value={k} label={v} />)}
      </Tabs>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? <ListSkeleton rows={3} height={130} /> : data?.items.length ? (
        <Stack spacing={1.5}>
          {data.items.map((a) => (
            <Card key={a.id} sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6" component="h2">{a.provider?.nameAr}</Typography>
                    <StatusChip value={a.status} map={APPOINTMENT_STATUS} />
                  </Stack>
                  <Typography color="text.secondary">{a.specialty?.nameAr} • {APPOINTMENT_TYPE[a.type]}</Typography>
                  <Typography sx={{ mt: 1, fontWeight: 600, fontSize: 17 }}>{fmtDate(a.startAt)} — {fmtTime(a.startAt)}</Typography>
                  {a.branch && (
                    <Stack direction="row" spacing={0.5} sx={{ color: 'text.secondary' }}>
                      <PlaceOutlined sx={{ fontSize: 18, mt: '3px' }} />
                      <Typography variant="body2">{a.branch.name} — {a.branch.address}</Typography>
                    </Stack>
                  )}
                  {a.homeAddress && <Typography variant="body2" color="text.secondary">عنوان الزيارة: {a.homeAddress}</Typography>}
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">رقم الحجز <span dir="ltr">{a.code}</span> • {fmtMoney(a.finalPrice)}{Number(a.discount) > 0 ? ` (بعد خصم ${fmtMoney(a.discount)})` : ''}</Typography>
                    {a.paymentStatus === 'PAID' && <Chip size="small" color="success" variant="outlined" label="مدفوع" />}
                    {a.paymentStatus === 'REFUNDED' && <Chip size="small" variant="outlined" label="تم الاسترداد" />}
                  </Stack>
                  {a.cancelReason && <Typography variant="body2" color="error">سبب الإلغاء: {a.cancelReason}</Typography>}
                </Box>
                <Stack direction={{ xs: 'row', md: 'column' }} spacing={1} alignItems={{ md: 'flex-end' }} flexWrap="wrap" useFlexGap>
                  {a.paymentStatus === 'PENDING' && ['PENDING', 'CONFIRMED'].includes(a.status) && Number(a.finalPrice) > 0 && <PayOnlineButton entityType="APPOINTMENT" entityId={a.id} />}
                  {a.canReschedule && <Button variant="outlined" onClick={() => setResched(a)}>تغيير الموعد</Button>}
                  {a.canCancel && <Button color="error" onClick={() => setCancel(a)}>إلغاء</Button>}
                  {a.status === 'COMPLETED' && <Button variant="outlined" onClick={() => setReview(a)}>قيّم الزيارة</Button>}
                  <ChatButton icon payload={{ type: 'PATIENT_PROVIDER', providerId: a.providerId }} label="مراسلة العيادة" color="primary" />
                  {a.provider?.whatsappNumber && ['PENDING', 'CONFIRMED'].includes(a.status) && (
                    <Tooltip title="راسل العيادة على واتساب">
                      <IconButton color="success" href={whatsappLink(a.provider.whatsappNumber, { doctorName: a.provider.nameAr })} target="_blank" rel="noopener noreferrer" aria-label="واتساب">
                        <WhatsApp />
                      </IconButton>
                    </Tooltip>
                  )}
                  {!a.canCancel && ['PENDING', 'CONFIRMED'].includes(a.status) && new Date(a.startAt) > new Date() && (
                    <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 200 }}>انتهت مهلة الإلغاء/التغيير — تواصل مع العيادة</Typography>
                  )}
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : (
        <EmptyState title={tab === 'upcoming' ? 'لا توجد مواعيد قادمة' : 'لا توجد مواعيد'} action={tab === 'upcoming' && <Button component={RouterLink} to="/doctors" variant="contained">احجز موعد</Button>} />
      )}
      {data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 2 }}><Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} /></Stack>}
      <CancelDialog appointment={cancel} onClose={() => setCancel(null)} />
      <RescheduleDialog appointment={resched} onClose={() => setResched(null)} />
      <ReviewDialog appointment={review} onClose={() => setReview(null)} />
    </>
  );
}

export function PatientFavorites() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['favorites'], queryFn: () => api.get('/favorites').then((r) => r.data) });
  const remove = useMutation({ mutationFn: (id) => api.delete(`/favorites/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }) });
  return (
    <>
      <PageHeader title="المفضلة" />
      {isLoading ? <ListSkeleton /> : data.length ? (
        <Grid container spacing={2}>
          {data.map((f) => (
            <Grid xs={12} sm={6} lg={4} key={f.providerId}>
              <Card sx={{ p: 2 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Avatar src={fileUrl(f.avatarFileId) || undefined} sx={{ width: 56, height: 56, bgcolor: tokens.mint, color: tokens.petrol }}>{f.name[0]}</Avatar>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>{f.name}</Typography>
                    <Chip size="small" label={PROVIDER_TYPE[f.type]} sx={{ mt: 0.5 }} />
                  </Box>
                  <Tooltip title="إزالة من المفضلة">
                    <IconButton onClick={() => remove.mutate(f.providerId)} aria-label="إزالة"><Favorite color="error" /></IconButton>
                  </Tooltip>
                </Stack>
                <Box sx={{ mt: 1 }}><Rating value={f.ratingAvg} count={f.ratingCount} /></Box>
                <Button fullWidth variant="outlined" sx={{ mt: 1.5 }} component={RouterLink} to={f.type === 'DOCTOR' ? `/doctors/${f.slug}` : `/providers/${f.slug}`}>
                  {f.type === 'DOCTOR' ? 'احجز موعد' : 'عرض التفاصيل'}
                </Button>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <EmptyState title="قائمة المفضلة فارغة" body="اضغط على علامة القلب في صفحة أي طبيب للرجوع إليه بسرعة." action={<Button component={RouterLink} to="/doctors" variant="contained">تصفح الأطباء</Button>} />
      )}
    </>
  );
}
