import { useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  
  IconButton,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import WhatsApp from '@mui/icons-material/WhatsApp';
import FavoriteBorder from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import CheckCircle from '@mui/icons-material/CheckCircleRounded';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorCode, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import SlotPicker from '../../components/SlotPicker';
import ChatButton from '../../components/ChatButton';
import { DoctorAvatar, Rating } from '../../components/DoctorCard';
import { EmptyState, ErrorState, Section } from '../../components/common';
import { DAYS, fmtDate, fmtHHmm, fmtMoney, fmtShortDate, fmtTime } from '../../utils/format';
import { APPOINTMENT_TYPE, LANGUAGES } from '../../utils/labels';
import { whatsappLink } from '../../utils/whatsapp';
import { startCheckout, usePaymentsConfig } from '../../api/payments';
import { CouponField } from '../../components/payments/PayUi';
import { tokens } from '../../theme';

export default function DoctorProfile() {
  const { key } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const bookingRef = useRef(null);
  const [type, setType] = useState('CLINIC');
  const [slot, setSlot] = useState(null);
  const [notes, setNotes] = useState('');
  const [homeAddress, setHomeAddress] = useState('');
  const [booked, setBooked] = useState(null);
  const [coupon, setCoupon] = useState(null);
  const [paying, setPaying] = useState(false);
  const { data: payCfg } = usePaymentsConfig();

  const { data: d, isLoading, error, refetch } = useQuery({
    queryKey: ['doctor', key],
    queryFn: () => api.get(`/doctors/${encodeURIComponent(key)}`).then((r) => r.data),
  });
  const isPatient = !!user?.patientId;
  const { data: favIds = [] } = useQuery({
    queryKey: ['favorites', 'ids'],
    queryFn: () => api.get('/favorites/ids').then((r) => r.data),
    enabled: isPatient,
  });
  const isFav = d && favIds.includes(d.providerId);

  const fav = useMutation({
    mutationFn: () => (isFav ? api.delete(`/favorites/${d.providerId}`) : api.put(`/favorites/${d.providerId}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });

  const book = useMutation({
    mutationFn: () =>
      api.post('/appointments', { doctorId: d.id, startAt: slot.startAt, type, notes: notes || undefined, homeAddress: type === 'HOME' ? homeAddress : undefined, couponCode: coupon?.code }).then((r) => r.data),
    onSuccess: (a) => {
      setBooked(a);
      setSlot(null);
      setCoupon(null);
      qc.invalidateQueries({ queryKey: ['availability', d.id] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e) => {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      if (errorCode(e) === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        qc.invalidateQueries({ queryKey: ['availability', d.id] });
      }
    },
  });

  const requireLogin = () => nav(`/login?next=${encodeURIComponent(loc.pathname)}`);

  if (error) return <Container sx={{ py: 6 }}>{error.response?.status === 404 ? <EmptyState title="الطبيب غير موجود" body="ربما تم إيقاف هذا الحساب أو الرابط غير صحيح." action={<Button component={RouterLink} to="/doctors" variant="contained">ابحث عن طبيب آخر</Button>} /> : <ErrorState error={error} onRetry={refetch} />}</Container>;
  if (isLoading) return <Container sx={{ py: 4 }}><Skeleton variant="rounded" height={180} /><Skeleton variant="rounded" height={400} sx={{ mt: 2 }} /></Container>;

  const types = ['CLINIC', d.onlineAvailable && 'ONLINE', d.homeVisitAvailable && 'HOME'].filter(Boolean);
  const price = type === 'ONLINE' ? d.onlinePrice ?? d.consultationPrice : type === 'HOME' ? d.homeVisitPrice ?? d.consultationPrice : d.consultationPrice;
  const wa = whatsappLink(d.whatsappNumber, { doctorName: d.displayName, specialty: d.primarySpecialty?.nameAr, slot, patientName: user?.fullName });
  const branchById = Object.fromEntries((d.branches || []).map((b) => [b.id, b]));
  const pickedBranch = slot?.branchId ? branchById[slot.branchId] : null;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {d.verificationStatus !== 'APPROVED' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          هذا الملف غير ظاهر للمرضى حتى تتم مراجعته واعتماده.
        </Alert>
      )}
      <Grid container spacing={3}>
        <Grid xs={12} md={7}>
          <Card sx={{ p: { xs: 2, md: 3 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5}>
              <DoctorAvatar doctor={d} size={112} />
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '1.5rem', md: '1.8rem' } }}>
                    {d.displayName}
                  </Typography>
                  {d.licenseVerified && (
                    <Tooltip title="تمت مراجعة الترخيص">
                      <VerifiedRounded sx={{ color: tokens.petrol }} />
                    </Tooltip>
                  )}
                </Stack>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  {d.specialties.map((s) => s.nameAr).join('، ')}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <Rating value={d.ratingAvg} count={d.ratingCount} />
                </Box>
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                  {d.experienceYears > 0 && <Chip label={`خبرة ${d.experienceYears} سنة`} />}
                  {d.languages?.length > 0 && <Chip variant="outlined" label={`يتحدث: ${d.languages.map((l) => LANGUAGES[l] || l).join('، ')}`} />}
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
                  <Button variant="contained" onClick={() => bookingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    احجز موعد
                  </Button>
                  {(!user || isPatient) && <ChatButton payload={{ type: 'PATIENT_PROVIDER', providerId: d.providerId }} />}
                  {wa && (
                    <Button variant="outlined" color="success" startIcon={<WhatsApp />} href={wa} target="_blank" rel="noopener noreferrer">
                      احجز عبر واتساب
                    </Button>
                  )}
                  <Tooltip title={isFav ? 'إزالة من المفضلة' : 'أضف إلى المفضلة'}>
                    <IconButton aria-label="المفضلة" onClick={() => (isPatient ? fav.mutate() : requireLogin())} sx={{ border: `1px solid ${tokens.line}` }}>
                      {isFav ? <FavoriteIcon color="error" /> : <FavoriteBorder />}
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
            </Stack>
          </Card>

          {d.bio && (
            <Section title="عن الطبيب" sx={{ mt: 2 }}>
              <Typography sx={{ whiteSpace: 'pre-line' }}>{d.bio}</Typography>
              {d.qualifications && (
                <>
                  <Typography variant="h6" sx={{ mt: 2, mb: 0.5 }}>
                    المؤهلات
                  </Typography>
                  <Typography sx={{ whiteSpace: 'pre-line' }} color="text.secondary">
                    {d.qualifications}
                  </Typography>
                </>
              )}
            </Section>
          )}

          <Section title="العيادات ومواعيد العمل" sx={{ mt: 2 }}>
            <Stack spacing={2}>
              {d.branches.map((b) => (
                <Box key={b.id}>
                  <Typography sx={{ fontWeight: 600 }}>{b.name}</Typography>
                  <Stack direction="row" spacing={0.5} sx={{ color: 'text.secondary' }}>
                    <PlaceOutlined sx={{ fontSize: 18, mt: '3px' }} />
                    <Typography variant="body2">{[b.address, b.area?.nameAr, b.city?.nameAr].filter(Boolean).join('، ')}</Typography>
                  </Stack>
                  <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 3, rowGap: 0.5, mt: 1, mb: 0 }}>
                    {d.workingHours
                      .filter((h) => h.branchId === b.id)
                      .map((h, i) => (
                        <Box key={i} sx={{ display: 'contents' }}>
                          <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
                            {DAYS[h.dayOfWeek]}
                          </Typography>
                          <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                            {fmtHHmm(h.start)} – {fmtHHmm(h.end)}
                          </Typography>
                        </Box>
                      ))}
                  </Box>
                </Box>
              ))}
              {d.workingHours.some((h) => h.type !== 'CLINIC') && (
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>مواعيد الأونلاين والزيارات المنزلية</Typography>
                  {d.workingHours
                    .filter((h) => h.type !== 'CLINIC')
                    .map((h, i) => (
                      <Typography key={i} variant="body2" color="text.secondary">
                        {APPOINTMENT_TYPE[h.type]}: {DAYS[h.dayOfWeek]} {fmtHHmm(h.start)} – {fmtHHmm(h.end)}
                      </Typography>
                    ))}
                </Box>
              )}
            </Stack>
          </Section>

          {d.services?.length > 0 && (
            <Section title="الخدمات والأسعار" sx={{ mt: 2 }}>
              <Stack divider={<Box sx={{ borderTop: `1px solid ${tokens.line}` }} />}>
                {d.services.map((s) => (
                  <Stack key={s.id} direction="row" justifyContent="space-between" sx={{ py: 1 }}>
                    <Typography>{s.name}</Typography>
                    <Typography sx={{ fontWeight: 600 }}>{fmtMoney(s.price)}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Section>
          )}

          <Reviews providerId={d.providerId} initial={d.reviews} total={d.ratingCount} />
        </Grid>

        <Grid xs={12} md={5}>
          <Card ref={bookingRef} sx={{ p: { xs: 2, md: 2.5 }, position: { md: 'sticky' }, top: { md: 88 }, scrollMarginTop: 90 }}>
            <Typography variant="h5" component="h2">
              احجز موعدك
            </Typography>
            {types.length > 1 && (
              <Tabs value={type} onChange={(_, v) => { setType(v); setSlot(null); setCoupon(null); }} sx={{ mt: 1 }} variant="fullWidth">
                {types.map((t) => (
                  <Tab key={t} value={t} label={APPOINTMENT_TYPE[t]} />
                ))}
              </Tabs>
            )}
            <Stack direction="row" justifyContent="space-between" sx={{ my: 1.5, p: 1.5, bgcolor: tokens.mint, borderRadius: '8px' }}>
              <Typography>سعر الكشف</Typography>
              <Typography sx={{ fontWeight: 700, color: tokens.petrol }}>
                {coupon ? (
                  <>
                    <Box component="s" sx={{ color: 'text.secondary', fontWeight: 400, mx: 1 }}>{fmtMoney(price)}</Box>
                    {fmtMoney(coupon.total)}
                  </>
                ) : (
                  fmtMoney(price)
                )}
              </Typography>
            </Stack>
            <SlotPicker doctorId={d.id} type={type} value={slot} onChange={setSlot} horizonDays={d.bookingHorizonDays} />
            {slot && (
              <Box sx={{ mt: 2 }}>
                <Box sx={{ p: 1.5, border: `1.5px dashed ${tokens.saffron}`, borderRadius: '10px', bgcolor: tokens.saffronSoft }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {fmtDate(slot.startAt)} — {fmtTime(slot.startAt)}
                  </Typography>
                  {pickedBranch && (
                    <Typography variant="body2" color="text.secondary">
                      {pickedBranch.name} • {pickedBranch.address}
                    </Typography>
                  )}
                </Box>
                {type === 'HOME' && (
                  <TextField label="عنوان الزيارة بالتفصيل" required multiline minRows={2} sx={{ mt: 1.5 }} value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} />
                )}
                <TextField label="سبب الزيارة أو ملاحظات للطبيب (اختياري)" multiline minRows={2} sx={{ mt: 1.5 }} value={notes} onChange={(e) => setNotes(e.target.value)} inputProps={{ maxLength: 1000 }} />
                {isPatient && (
                  <Box sx={{ mt: 1.5 }}>
                    <CouponField serviceType="APPOINTMENT" providerId={d.providerId} amount={price} value={coupon} onChange={setCoupon} />
                  </Box>
                )}
                {user && !isPatient ? (
                  <Alert severity="info" sx={{ mt: 1.5 }}>
                    الحجز متاح لحسابات المرضى فقط.
                  </Alert>
                ) : (
                  <Button
                    fullWidth
                    size="large"
                    variant="contained"
                    sx={{ mt: 1.5 }}
                    disabled={book.isPending || (type === 'HOME' && homeAddress.trim().length < 5)}
                    onClick={() => (user ? book.mutate() : requireLogin())}
                  >
                    {user ? (book.isPending ? 'جاري الحجز…' : 'تأكيد الحجز') : 'سجّل الدخول لإتمام الحجز'}
                  </Button>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  يمكنك الإلغاء أو تغيير الموعد حتى {d.cancellationWindowHours} ساعة قبل الكشف.
                </Typography>
              </Box>
            )}
          </Card>
        </Grid>
      </Grid>

      <Dialog open={!!booked} onClose={() => setBooked(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ textAlign: 'center', pt: 3 }}>
          <CheckCircle sx={{ fontSize: 56, color: tokens.success }} />
          <Typography variant="h5" component="div">
            {booked?.status === 'CONFIRMED' ? 'تم تأكيد حجزك' : 'تم إرسال طلب الحجز'}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          {booked && (
            <>
              <Typography>
                {fmtDate(booked.startAt)} — {fmtTime(booked.startAt)}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                رقم الحجز: <b dir="ltr">{booked.code}</b>
              </Typography>
              {booked.status === 'PENDING' && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  سيصلك إشعار عند تأكيد الطبيب للموعد.
                </Typography>
              )}
              <Typography sx={{ mt: 1 }}>
                المطلوب: <b>{fmtMoney(booked.finalPrice)}</b>
                {Number(booked.discount) > 0 && <Typography component="span" color="success.main" variant="body2"> (بعد خصم {fmtMoney(booked.discount)})</Typography>}
              </Typography>
              {payCfg?.online && Number(booked.finalPrice) > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  ادفع الآن أونلاين أو في العيادة يوم الكشف.
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 3 }}>
          <Button onClick={() => setBooked(null)}>إغلاق</Button>
          {payCfg?.online && booked && Number(booked.finalPrice) > 0 && (
            <Button
              variant="outlined"
              disabled={paying}
              onClick={() => {
                setPaying(true);
                startCheckout('APPOINTMENT', booked.id).catch((e) => {
                  setPaying(false);
                  enqueueSnackbar(errorMessage(e), { variant: 'error' });
                });
              }}
            >
              ادفع أونلاين
            </Button>
          )}
          <Button variant="contained" component={RouterLink} to="/patient/appointments">
            مواعيدي
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

function Reviews({ providerId, initial = [], total }) {
  const [size, setSize] = useState(5);
  const { data } = useQuery({
    queryKey: ['reviews', providerId, size],
    queryFn: () => api.get(`/providers/${providerId}/reviews?page=1&pageSize=${size}`).then((r) => r.data),
    enabled: size > 5,
    placeholderData: (prev) => prev,
  });
  const items = data?.items || initial;
  return (
    <Section title={`آراء المرضى${total ? ` (${total})` : ''}`} sx={{ mt: 2 }}>
      {items.length === 0 ? (
        <Typography color="text.secondary">لا توجد تقييمات بعد. التقييم متاح فقط للمرضى بعد إتمام الكشف.</Typography>
      ) : (
        <Stack spacing={2}>
          {items.map((r) => (
            <Box key={r.id}>
              <Stack direction="row" justifyContent="space-between">
                <Typography sx={{ fontWeight: 600 }}>{r.patientName}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {fmtShortDate(r.createdAt)}
                </Typography>
              </Stack>
              <Typography sx={{ color: tokens.saffron, letterSpacing: 2 }} aria-label={`${r.rating} من 5`}>
                {'★'.repeat(r.rating)}
                <Box component="span" sx={{ color: tokens.line }}>
                  {'★'.repeat(5 - r.rating)}
                </Box>
              </Typography>
              {r.comment && <Typography variant="body2">{r.comment}</Typography>}
            </Box>
          ))}
          {items.length < total && (
            <Button onClick={() => setSize((s) => Math.min(s + 10, 100))} sx={{ alignSelf: 'flex-start' }}>
              عرض المزيد
            </Button>
          )}
        </Stack>
      )}
    </Section>
  );
}
