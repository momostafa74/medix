import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Card,
  Chip,
  Container,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Pagination,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import SearchIcon from '@mui/icons-material/Search';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { api, errorMessage, fileUrl, qs } from '../../api/client';
import { MODALITY, useRadCatalog } from '../../api/radiology';
import { useAuth } from '../../auth/AuthProvider';
import { CouponField, DiscountLine } from '../../components/payments/PayUi';
import FileUploadButton from '../../components/FileUploadButton';
import LocationSelect from '../../components/LocationSelect';
import { EmptyState, ErrorState, ListSkeleton, Section, useDebounced } from '../../components/common';
import { fmtDate, fmtMoney, fmtTime, TZ } from '../../utils/format';
import { tokens } from '../../theme';

/** Services grouped by modality — embedded in a radiology center's public profile. */
export function RadiologyCatalogSection({ slug }) {
  const { data, isLoading, error, refetch } = useRadCatalog(slug);
  const [mod, setMod] = useState('');
  const [q, setQ] = useState('');
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton variant="rounded" height={300} />;
  const mods = [...new Set(data.services.map((s) => s.modality))];
  const shown = data.services.filter((s) => (!mod || s.modality === mod) && (!q || s.name.includes(q)));
  return (
    <Card sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" sx={{ mb: 2 }}>
        <ToggleButtonGroup size="small" exclusive value={mod} onChange={(_, v) => setMod(v ?? '')} sx={{ flexWrap: 'wrap' }}>
          <ToggleButton value="">الكل ({data.services.length})</ToggleButton>
          {mods.map((m) => <ToggleButton key={m} value={m}>{MODALITY[m] || m}</ToggleButton>)}
        </ToggleButtonGroup>
        <TextField size="small" placeholder="ابحث في الخدمات" value={q} onChange={(e) => setQ(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
      </Stack>
      {shown.length ? (
        <Stack divider={<Divider flexItem />}>
          {shown.map((s) => (
            <Stack key={s.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ py: 1.25 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography sx={{ fontWeight: 600 }}>{s.name}</Typography>
                  <Chip size="small" variant="outlined" label={MODALITY[s.modality] || s.modality} />
                  {s.requiresReferral && <Chip size="small" icon={<DescriptionOutlined />} label="يتطلب تحويل" color="warning" variant="outlined" />}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  مدة الفحص {s.durationMinutes} دقيقة{s.turnaroundHours ? ` • التقرير خلال ${s.turnaroundHours} ساعة` : ''}
                </Typography>
                {s.preparationInstructions && <Typography variant="body2" sx={{ color: '#8A5A00' }}>تحضير: {s.preparationInstructions}</Typography>}
              </Box>
              <Typography sx={{ fontWeight: 700, minWidth: 90 }}>{fmtMoney(s.price)}</Typography>
              <Button variant="contained" component={RouterLink} to={`/radiology/${slug}/book?service=${s.id}`}>احجز</Button>
            </Stack>
          ))}
        </Stack>
      ) : (
        <EmptyState title="لا توجد خدمات مطابقة" />
      )}
    </Card>
  );
}

/** Search a scan across all centers, cheapest first. */
export function RadiologyServicesSearch() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') || '');
  const [modality, setModality] = useState(params.get('modality') || '');
  const [loc, setLoc] = useState({});
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['radiology-search', search, modality, loc, page],
    queryFn: () => api.get(`/radiology-services/search${qs({ search, modality, ...loc, page, pageSize: 10 })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1">ابحث عن فحص أشعة</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>قارن أسعار الأشعة في المراكز المعتمدة واحجز موعدك مباشرة.</Typography>
      <Stack spacing={1.5} sx={{ my: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField fullWidth placeholder="مثال: رنين على الركبة، سونار بطن" value={text} onChange={(e) => { setText(e.target.value); setPage(1); setParams(e.target.value ? { q: e.target.value } : {}, { replace: true }); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} inputProps={{ 'aria-label': 'ابحث عن فحص' }} />
          <TextField select label="نوع الأشعة" value={modality} onChange={(e) => { setModality(e.target.value); setPage(1); }} sx={{ minWidth: 200 }}>
            <MenuItem value="">كل الأنواع</MenuItem>
            {Object.entries(MODALITY).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
        </Stack>
        <LocationSelect value={loc} onChange={(v) => { setLoc(v); setPage(1); }} />
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? <ListSkeleton rows={3} height={90} /> : data?.items.length ? (
        <Stack spacing={1.25}>
          {data.items.map((s) => (
            <Card key={s.serviceId} sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                <Avatar variant="rounded" src={fileUrl(s.center.logoFileId) || undefined} sx={{ width: 48, height: 48, bgcolor: tokens.mint, color: tokens.petrol, fontWeight: 700 }}>{s.center.nameAr[0]}</Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>{s.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    <RouterLink to={`/providers/${s.center.slug}`} style={{ color: 'inherit' }}>{s.center.nameAr}</RouterLink> • {MODALITY[s.modality]} • {s.durationMinutes} دقيقة
                  </Typography>
                  {s.requiresReferral && <Chip size="small" sx={{ mt: 0.5 }} label="يتطلب خطاب تحويل" color="warning" variant="outlined" />}
                </Box>
                <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{fmtMoney(s.price)}</Typography>
                <Button variant="contained" component={RouterLink} to={`/radiology/${s.center.slug}/book?service=${s.serviceId}`}>احجز</Button>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : (
        <EmptyState title="لم نجد فحصاً مطابقاً" body="جرّب كلمة أخرى أو اختر نوع الأشعة." />
      )}
      {data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 3 }}><Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" /></Stack>}
    </Container>
  );
}

function ExamSlotPicker({ slug, serviceId, branchId, horizon, value, onChange }) {
  const [offset, setOffset] = useState(0);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => dayjs().tz(TZ).add(offset + i, 'day').format('YYYY-MM-DD')), [offset]);
  const [date, setDate] = useState(days[0]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['radiology-slots', slug, serviceId, branchId, date],
    queryFn: () => api.get(`/radiology/${slug}/slots${qs({ date, serviceId, branchId })}`).then((r) => r.data),
    enabled: !!(serviceId && branchId),
    staleTime: 10_000,
  });
  const move = (delta) => {
    const o = offset + delta;
    setOffset(o);
    setDate(dayjs().tz(TZ).add(o, 'day').format('YYYY-MM-DD'));
    onChange(null);
  };
  if (!branchId) return <Typography color="text.secondary">اختر الفرع أولاً.</Typography>;
  const open = data?.slots.filter((s) => s.remaining > 0) || [];
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <IconButton aria-label="الأيام السابقة" disabled={offset === 0} onClick={() => move(-7)}><ChevronRight /></IconButton>
        <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: { xs: 'repeat(4, 1fr)', sm: 'repeat(7, 1fr)' }, gap: 0.75 }}>
          {days.map((d, i) => {
            const dj = dayjs.tz(d, TZ);
            const sel = d === date;
            return (
              <ButtonBase key={d} onClick={() => { setDate(d); onChange(null); }} aria-pressed={sel}
                sx={{ display: { xs: i > 3 ? 'none' : 'flex', sm: 'flex' }, flexDirection: 'column', py: 1, borderRadius: '10px', border: `1.5px solid ${sel ? tokens.petrol : tokens.line}`, bgcolor: sel ? tokens.petrol : '#fff', color: sel ? '#fff' : tokens.ink }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{offset === 0 && i === 0 ? 'اليوم' : offset === 0 && i === 1 ? 'غداً' : dj.format('ddd')}</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 20, lineHeight: 1.2 }}>{dj.format('D')}</Typography>
                <Typography sx={{ fontSize: 11, opacity: 0.8 }}>{dj.format('MMM')}</Typography>
              </ButtonBase>
            );
          })}
        </Box>
        <IconButton aria-label="الأيام التالية" disabled={offset + 7 > horizon} onClick={() => move(7)}><ChevronLeft /></IconButton>
      </Stack>
      <Box sx={{ mt: 2, minHeight: 60 }}>
        {error && <ErrorState error={error} />}
        {isLoading ? <Skeleton variant="rounded" height={56} /> : !data?.slots.length ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>لا توجد مواعيد لهذا الفحص في هذا اليوم — جرّب يوماً آخر.</Typography>
        ) : (
          <>
            {!open.length && <Typography color="text.secondary" sx={{ pb: 1, textAlign: 'center' }}>كل المواعيد محجوزة في هذا اليوم.</Typography>}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 1 }}>
              {data.slots.map((s) => {
                const full = s.remaining < 1;
                const sel = value?.startAt === s.startAt;
                return (
                  <ButtonBase key={s.startAt} disabled={full} onClick={() => onChange(s)} aria-pressed={sel} aria-label={`${fmtTime(s.startAt)}${full ? ' محجوز' : ''}`}
                    sx={{ py: 1.1, borderRadius: '999px', fontWeight: 600, fontSize: 15, border: `1.5px dashed ${sel ? tokens.saffron : full ? tokens.line : tokens.petrol}`, bgcolor: sel ? tokens.saffron : full ? 'transparent' : tokens.mint, color: full ? tokens.inkSoft : sel ? tokens.ink : tokens.petrol, textDecoration: full ? 'line-through' : 'none' }}>
                    {fmtTime(s.startAt)}
                  </ButtonBase>
                );
              })}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

export default function RadiologyBooking() {
  const { key } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = useRadCatalog(key);
  const [serviceId, setServiceId] = useState(params.get('service') || '');
  const [branchId, setBranchId] = useState('');
  const [slot, setSlot] = useState(null);
  const [referral, setReferral] = useState(null);
  const [indication, setIndication] = useState('');
  const [referringDoctor, setReferringDoctor] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [coupon, setCoupon] = useState(null);
  const book = useMutation({
    mutationFn: (body) => api.post('/radiology-orders', body).then((r) => r.data),
    onSuccess: (o) => {
      enqueueSnackbar('تم الحجز بنجاح', { variant: 'success' });
      nav(`/patient/radiology/${o.id}`);
    },
    onError: (e) => {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      if (e.response?.data?.error === 'SLOT_FULL') setSlot(null);
    },
  });
  if (error) return <Container sx={{ py: 6 }}><ErrorState error={error} onRetry={refetch} /></Container>;
  if (isLoading) return <Container sx={{ py: 4 }}><Skeleton variant="rounded" height={400} /></Container>;
  const service = data.services.find((s) => s.id === serviceId);
  const branches = service ? data.branches.filter((b) => b.modalities.includes(service.modality)) : [];
  const effectiveBranch = branchId && branches.some((b) => b.id === branchId) ? branchId : branches.length === 1 ? branches[0].id : '';
  const isPatient = !!user?.patientId;
  const activeCoupon = coupon && service && coupon.base === service.id ? coupon : null;
  const canSubmit = isPatient && service && effectiveBranch && slot && (!service.requiresReferral || referral);
  const loginNext = `/login?next=${encodeURIComponent(`/radiology/${key}/book?service=${serviceId}`)}`;
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="body2" color="text.secondary"><RouterLink to={`/providers/${data.provider.slug}`} style={{ color: 'inherit' }}>{data.provider.nameAr}</RouterLink></Typography>
      <Typography variant="h3" component="h1" sx={{ mb: 3 }}>حجز أشعة</Typography>
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          <Stack spacing={2}>
            <Section title="1. الفحص">
              <TextField select fullWidth label="الفحص المطلوب" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSlot(null); setBranchId(''); }}>
                {data.services.map((s) => <MenuItem key={s.id} value={s.id}>{s.name} — {fmtMoney(s.price)}</MenuItem>)}
              </TextField>
              {service?.preparationInstructions && <Alert severity="warning" sx={{ mt: 1.5 }}>قبل الفحص: {service.preparationInstructions}</Alert>}
            </Section>
            <Section title="2. الفرع">
              {!service ? <Typography color="text.secondary">اختر الفحص أولاً.</Typography> : branches.length ? (
                <Stack spacing={1}>
                  {branches.map((b) => (
                    <ButtonBase key={b.id} onClick={() => { setBranchId(b.id); setSlot(null); }} sx={{ display: 'block', textAlign: 'right', p: 1.5, borderRadius: '10px', border: `1.5px solid ${effectiveBranch === b.id ? tokens.petrol : tokens.line}`, bgcolor: effectiveBranch === b.id ? tokens.mint : '#fff' }}>
                      <Typography sx={{ fontWeight: 600 }}>{b.name}</Typography>
                      <Typography variant="body2" color="text.secondary">{[b.address, b.area, b.city].filter(Boolean).join('، ')}</Typography>
                    </ButtonBase>
                  ))}
                </Stack>
              ) : <Alert severity="info">هذا الفحص غير متاح للحجز أونلاين حالياً. تواصل مع المركز مباشرة.</Alert>}
            </Section>
            <Section title="3. الموعد">
              {service && <ExamSlotPicker key={`${serviceId}-${effectiveBranch}`} slug={key} serviceId={serviceId} branchId={effectiveBranch} horizon={data.center.bookingHorizonDays} value={slot} onChange={setSlot} />}
            </Section>
            <Section title={service?.requiresReferral ? '4. خطاب التحويل (مطلوب)' : '4. معلومات للطبيب (اختياري)'}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <FileUploadButton purpose="REFERRAL" label={referral ? 'تغيير الملف' : 'رفع خطاب التحويل'} onUploaded={setReferral} disabled={!isPatient} />
                  {referral && <Chip icon={<CheckCircleOutline />} color="success" variant="outlined" label={referral.originalName} onDelete={() => setReferral(null)} />}
                </Stack>
                <Typography variant="caption" color="text.secondary">صورة أو PDF. يطّلع عليه فريق المركز فقط.</Typography>
                <TextField label="سبب الفحص / الشكوى" multiline minRows={2} value={indication} onChange={(e) => setIndication(e.target.value)} />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField label="الطبيب المحوِّل" value={referringDoctor} onChange={(e) => setReferringDoctor(e.target.value)} />
                  <TextField label="رقم للتواصل" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputProps={{ dir: 'ltr' }} />
                </Stack>
              </Stack>
            </Section>
          </Stack>
        </Grid>
        <Grid xs={12} md={4}>
          <Card sx={{ p: 2, position: { md: 'sticky' }, top: { md: 88 } }}>
            <Typography variant="h6" sx={{ mb: 1 }}>ملخص الحجز</Typography>
            {service ? (
              <Stack spacing={0.75}>
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 600 }}>{service.name}</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoney(service.price)}</Typography></Stack>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}><ScheduleOutlined fontSize="small" /><Typography variant="body2">مدة الفحص {service.durationMinutes} دقيقة</Typography></Stack>
                {slot && (
                  <Box sx={{ mt: 1, p: 1.25, borderRadius: '10px', bgcolor: tokens.mint }}>
                    <Typography sx={{ fontWeight: 600 }}>{fmtDate(slot.startAt)}</Typography>
                    <Typography>{fmtTime(slot.startAt)} — {fmtTime(slot.endAt)}</Typography>
                    <Typography variant="body2" color="text.secondary">{branches.find((b) => b.id === effectiveBranch)?.name}</Typography>
                  </Box>
                )}
                {isPatient && Number(service.price) > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <CouponField serviceType="RADIOLOGY" providerId={data.provider.id} amount={Number(service.price)} value={activeCoupon} onChange={(v) => setCoupon(v ? { ...v, base: service.id } : null)} />
                  </Box>
                )}
                <DiscountLine discount={activeCoupon?.discount} />
                {activeCoupon && <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>الإجمالي</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoney(activeCoupon.total)}</Typography></Stack>}
                <Typography variant="caption" color="text.secondary">ادفع أونلاين بعد الحجز أو في المركز يوم الفحص.</Typography>
              </Stack>
            ) : (
              <Typography color="text.secondary">اختر الفحص.</Typography>
            )}
            {service?.requiresReferral && !referral && <Alert severity="warning" sx={{ mt: 1.5 }}>هذا الفحص يتطلب رفع خطاب تحويل من الطبيب.</Alert>}
            {user ? (
              isPatient ? (
                <Button fullWidth size="large" variant="contained" sx={{ mt: 2 }} disabled={!canSubmit || book.isPending}
                  onClick={() => book.mutate({ serviceId, branchId: effectiveBranch, scheduledAt: slot.startAt, referralFileId: referral?.id, clinicalIndication: indication || undefined, referringDoctor: referringDoctor || undefined, contactPhone: contactPhone || undefined, couponCode: activeCoupon?.code })}>
                  {book.isPending ? 'جاري الحجز…' : 'تأكيد الحجز'}
                </Button>
              ) : <Alert severity="info" sx={{ mt: 2 }}>الحجز متاح لحسابات المرضى فقط.</Alert>
            ) : (
              <Button fullWidth size="large" variant="contained" sx={{ mt: 2 }} component={RouterLink} to={loginNext}>سجّل الدخول لتأكيد الحجز</Button>
            )}
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
