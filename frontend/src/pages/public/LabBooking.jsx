import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  Checkbox,
  Chip,
  Container,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client';
import { useLabCatalog } from '../../api/labs';
import { CouponField, DiscountLine } from '../../components/payments/PayUi';
import { useAuth } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, Section } from '../../components/common';
import { fmtDate, fmtMoney, fmtTime, inTz, TZ } from '../../utils/format';
import { tokens } from '../../theme';

const readIds = (v) => (v ? v.split(',').filter(Boolean) : []);

/** Catalog with a running cart — embedded in a laboratory's public profile. */
export function LabCatalogSection({ slug }) {
  const { data, isLoading, error, refetch } = useLabCatalog(slug);
  const nav = useNavigate();
  const [tab, setTab] = useState('tests');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [tests, setTests] = useState([]);
  const [packages, setPackages] = useState([]);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton variant="rounded" height={320} />;
  const covered = new Set(data.packages.filter((p) => packages.includes(p.id)).flatMap((p) => p.tests.map((t) => t.id)));
  const total =
    data.tests.filter((t) => tests.includes(t.id)).reduce((s, t) => s + Number(t.price), 0) +
    data.packages.filter((p) => packages.includes(p.id)).reduce((s, p) => s + Number(p.price), 0);
  const shown = data.tests.filter((t) => (!cat || t.categoryId === cat) && (!q || `${t.name} ${t.code}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const count = tests.length + packages.length;
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="tests" label={`التحاليل (${data.tests.length})`} />
        <Tab value="packages" label={`الباقات (${data.packages.length})`} />
      </Tabs>
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          {tab === 'tests' ? (
            <Card sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
                <TextField size="small" fullWidth placeholder="ابحث في تحاليل المعمل" value={q} onChange={(e) => setQ(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
                <TextField size="small" select label="التصنيف" value={cat} onChange={(e) => setCat(e.target.value)} sx={{ minWidth: 160 }}>
                  <MenuItem value="">الكل</MenuItem>
                  {data.categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                </TextField>
              </Stack>
              {shown.length ? (
                <Stack divider={<Divider flexItem />}>
                  {shown.map((t) => {
                    const inPkg = covered.has(t.id);
                    return (
                      <Stack key={t.id} direction="row" alignItems="flex-start" spacing={1} sx={{ py: 1 }}>
                        <Checkbox checked={tests.includes(t.id) || inPkg} disabled={inPkg} onChange={() => toggle(tests, setTests, t.id)} inputProps={{ 'aria-label': t.name }} />
                        <Box sx={{ flex: 1, minWidth: 0, pt: 0.75 }}>
                          <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
                            <Typography sx={{ fontWeight: 600 }}>{t.name}</Typography>
                            <Typography variant="caption" color="text.secondary" dir="ltr">{t.code}</Typography>
                            {inPkg && <Chip size="small" label="ضمن الباقة المختارة" />}
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            {[t.sampleType && `العينة: ${t.sampleType}`, t.turnaroundHours && `النتيجة خلال ${t.turnaroundHours} ساعة`].filter(Boolean).join(' • ')}
                          </Typography>
                          {t.preparationInstructions && <Typography variant="body2" sx={{ color: '#8A5A00' }}>تحضير: {t.preparationInstructions}</Typography>}
                          {t.parameters.length > 1 && <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ display: 'block', textAlign: 'right' }}>{t.parameters.join(' · ')}</Typography>}
                        </Box>
                        <Typography sx={{ fontWeight: 700, pt: 0.75, whiteSpace: 'nowrap' }}>{fmtMoney(t.price)}</Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              ) : (
                <EmptyState title="لا توجد تحاليل مطابقة" />
              )}
            </Card>
          ) : data.packages.length ? (
            <Grid container spacing={1.5}>
              {data.packages.map((p) => {
                const on = packages.includes(p.id);
                return (
                  <Grid key={p.id} xs={12} sm={6}>
                    <Card sx={{ p: 2, height: '100%', borderColor: on ? tokens.petrol : undefined, borderWidth: on ? 2 : 1 }}>
                      <Typography variant="h6">{p.name}</Typography>
                      {p.description && <Typography variant="body2" color="text.secondary">{p.description}</Typography>}
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ my: 1 }}>
                        {p.tests.map((t) => <Chip key={t.id} size="small" variant="outlined" label={t.name} />)}
                      </Stack>
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Box>
                          <Typography sx={{ fontWeight: 700, fontSize: 20, color: tokens.petrol }}>{fmtMoney(p.price)}</Typography>
                          {p.savings > 0 && <Typography variant="caption" sx={{ color: tokens.success, fontWeight: 600 }}>توفير {fmtMoney(p.savings)} عن الحجز منفرداً</Typography>}
                        </Box>
                        <Button variant={on ? 'contained' : 'outlined'} onClick={() => { toggle(packages, setPackages, p.id); setTests((ts) => ts.filter((id) => !p.tests.some((t) => t.id === id))); }}>
                          {on ? 'تمت الإضافة' : 'أضف الباقة'}
                        </Button>
                      </Stack>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          ) : (
            <EmptyState title="لا توجد باقات حالياً" />
          )}
        </Grid>
        <Grid xs={12} md={4}>
          <Card sx={{ p: 2, position: { md: 'sticky' }, top: { md: 88 } }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <ScienceOutlined sx={{ color: tokens.petrol }} />
              <Typography variant="h6">طلبك</Typography>
            </Stack>
            {count ? (
              <Stack spacing={0.75}>
                {data.packages.filter((p) => packages.includes(p.id)).map((p) => (
                  <Stack key={p.id} direction="row" justifyContent="space-between"><Typography>{p.name}</Typography><Typography>{fmtMoney(p.price)}</Typography></Stack>
                ))}
                {data.tests.filter((t) => tests.includes(t.id)).map((t) => (
                  <Stack key={t.id} direction="row" justifyContent="space-between"><Typography>{t.name}</Typography><Typography>{fmtMoney(t.price)}</Typography></Stack>
                ))}
                <Divider />
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>الإجمالي</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoney(total)}</Typography></Stack>
              </Stack>
            ) : (
              <Typography color="text.secondary">اختر التحاليل أو الباقة المطلوبة.</Typography>
            )}
            <Button fullWidth variant="contained" size="large" sx={{ mt: 2 }} disabled={!count} onClick={() => nav(`/labs/${slug}/book?tests=${tests.join(',')}&packages=${packages.join(',')}`)}>
              اختر الموعد ({count})
            </Button>
            {data.laboratory.homeCollection && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>متاح سحب منزلي برسوم {fmtMoney(data.laboratory.homeCollectionFee)}</Typography>}
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

/** Day strip + time windows with remaining capacity. */
function WindowPicker({ slug, mode, branchId, horizon, value, onChange }) {
  const [offset, setOffset] = useState(0);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => dayjs().tz(TZ).add(offset + i, 'day').format('YYYY-MM-DD')), [offset]);
  const [date, setDate] = useState(days[0]);
  const enabled = mode === 'HOME' || !!branchId;
  const { data, isLoading, error } = useQuery({
    queryKey: ['lab-slots', slug, mode, branchId, date],
    queryFn: () => api.get(`/labs/${slug}/slots?date=${date}&mode=${mode}${branchId ? `&branchId=${branchId}` : ''}`).then((r) => r.data),
    enabled,
    staleTime: 10_000,
  });
  if (!enabled) return <Typography color="text.secondary">اختر الفرع أولاً.</Typography>;
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <IconButton aria-label="الأيام السابقة" disabled={offset === 0} onClick={() => { setOffset(offset - 7); setDate(dayjs().tz(TZ).add(offset - 7, 'day').format('YYYY-MM-DD')); }}><ChevronRight /></IconButton>
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
        <IconButton aria-label="الأيام التالية" disabled={offset + 7 > horizon} onClick={() => { setOffset(offset + 7); setDate(dayjs().tz(TZ).add(offset + 7, 'day').format('YYYY-MM-DD')); }}><ChevronLeft /></IconButton>
      </Stack>
      <Box sx={{ mt: 2, minHeight: 60 }}>
        {error && <ErrorState error={error} />}
        {isLoading ? (
          <Skeleton variant="rounded" height={56} />
        ) : !data?.slots.length ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>لا توجد مواعيد في هذا اليوم — جرّب يوماً آخر.</Typography>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 1 }}>
            {data.slots.map((s) => {
              const full = s.remaining < 1;
              const sel = value?.startAt === s.startAt;
              return (
                <ButtonBase key={s.startAt} disabled={full} onClick={() => onChange(s)} aria-pressed={sel}
                  aria-label={`${fmtTime(s.startAt)}${full ? ' مكتمل' : ''}`}
                  sx={{ flexDirection: 'column', py: 0.75, borderRadius: '12px', border: `1.5px dashed ${sel ? tokens.saffron : full ? tokens.line : tokens.petrol}`, bgcolor: sel ? tokens.saffron : full ? 'transparent' : tokens.mint, color: full ? tokens.inkSoft : sel ? tokens.ink : tokens.petrol, textDecoration: full ? 'line-through' : 'none' }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 15 }}>
                    {mode === 'HOME' ? `${inTz(s.startAt).format('h')}–${fmtTime(s.endAt)}` : fmtTime(s.startAt)}
                  </Typography>
                  <Typography sx={{ fontSize: 11 }}>{full ? 'مكتمل' : s.remaining <= 1 ? 'آخر مكان' : `${s.remaining} أماكن`}</Typography>
                </ButtonBase>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function LabBooking() {
  const { key } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = useLabCatalog(key);
  const [tests, setTests] = useState(readIds(params.get('tests')));
  const [packages, setPackages] = useState(readIds(params.get('packages')));
  const [mode, setMode] = useState('BRANCH');
  const [branchId, setBranchId] = useState('');
  const [slot, setSlot] = useState(null);
  const [homeAddress, setHomeAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [coupon, setCoupon] = useState(null);

  const book = useMutation({
    mutationFn: (body) => api.post('/lab-orders', body).then((r) => r.data),
    onSuccess: (o) => {
      enqueueSnackbar('تم الحجز بنجاح', { variant: 'success' });
      nav(`/patient/lab-orders/${o.id}`);
    },
    onError: (e) => {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      if (e.response?.data?.code === 'SLOT_FULL') setSlot(null);
    },
  });

  if (error) return <Container sx={{ py: 6 }}><ErrorState error={error} onRetry={refetch} /></Container>;
  if (isLoading) return <Container sx={{ py: 4 }}><Skeleton variant="rounded" height={400} /></Container>;

  const selTests = data.tests.filter((t) => tests.includes(t.id));
  const selPkgs = data.packages.filter((p) => packages.includes(p.id));
  const subtotal = selTests.reduce((s, t) => s + Number(t.price), 0) + selPkgs.reduce((s, p) => s + Number(p.price), 0);
  const fee = mode === 'HOME' ? Number(data.laboratory.homeCollectionFee || 0) : 0;
  const bookableBranches = data.branches.filter((b) => b.bookable);
  const effectiveBranch = branchId || (bookableBranches.length === 1 ? bookableBranches[0].id : '');
  const prep = [...selTests, ...selPkgs.flatMap((p) => p.tests.map((pt) => data.tests.find((t) => t.id === pt.id)).filter(Boolean))].map((t) => t.preparationInstructions).filter(Boolean);
  const isPatient = !!user?.patientId;
  // A previewed coupon is only valid for the basket it was checked against.
  const activeCoupon = coupon && coupon.base === subtotal ? coupon : null;
  const canSubmit = isPatient && (selTests.length || selPkgs.length) && slot && (mode === 'BRANCH' ? effectiveBranch : homeAddress.trim().length >= 5);

  const submit = () =>
    book.mutate({
      laboratoryId: data.laboratory.id,
      testIds: tests,
      packageIds: packages,
      mode,
      branchId: mode === 'BRANCH' ? effectiveBranch : undefined,
      scheduledAt: slot.startAt,
      homeAddress: mode === 'HOME' ? homeAddress : undefined,
      contactPhone: contactPhone || undefined,
      notes: notes || undefined,
      couponCode: activeCoupon?.code,
    });

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="body2" color="text.secondary"><RouterLink to={`/providers/${data.provider.slug}`} style={{ color: 'inherit' }}>{data.provider.nameAr}</RouterLink></Typography>
      <Typography variant="h3" component="h1" sx={{ mb: 3 }}>حجز تحاليل</Typography>
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          <Stack spacing={2}>
            <Section title="1. مكان سحب العينة">
              <ToggleButtonGroup exclusive value={mode} onChange={(_, v) => { if (v) { setMode(v); setSlot(null); } }} sx={{ mb: 2 }}>
                <ToggleButton value="BRANCH" sx={{ px: 2.5 }}><StorefrontOutlined sx={{ ml: 1 }} /> في الفرع</ToggleButton>
                <ToggleButton value="HOME" disabled={!data.laboratory.homeCollection} sx={{ px: 2.5 }}><HomeOutlined sx={{ ml: 1 }} /> سحب منزلي{data.laboratory.homeCollection ? ` (+${fmtMoney(data.laboratory.homeCollectionFee)})` : ''}</ToggleButton>
              </ToggleButtonGroup>
              {mode === 'BRANCH' ? (
                bookableBranches.length ? (
                  <Stack spacing={1}>
                    {bookableBranches.map((b) => (
                      <ButtonBase key={b.id} onClick={() => { setBranchId(b.id); setSlot(null); }} sx={{ display: 'block', textAlign: 'right', p: 1.5, borderRadius: '10px', border: `1.5px solid ${effectiveBranch === b.id ? tokens.petrol : tokens.line}`, bgcolor: effectiveBranch === b.id ? tokens.mint : '#fff' }}>
                        <Typography sx={{ fontWeight: 600 }}>{b.name}</Typography>
                        <Typography variant="body2" color="text.secondary">{[b.address, b.area, b.city].filter(Boolean).join('، ')}</Typography>
                      </ButtonBase>
                    ))}
                  </Stack>
                ) : (
                  <Alert severity="info">لم يحدد المعمل مواعيد الحجز في الفروع بعد. يمكنك التواصل معه مباشرة.</Alert>
                )
              ) : (
                <Stack spacing={1.5}>
                  <TextField label="عنوان سحب العينة بالتفصيل" multiline minRows={2} value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} required helperText="الشارع، رقم العمارة، الدور، علامة مميزة" />
                  <TextField label="رقم للتواصل (اختياري)" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputProps={{ dir: 'ltr' }} sx={{ maxWidth: 280 }} />
                </Stack>
              )}
            </Section>
            <Section title={mode === 'HOME' ? '2. وقت زيارة فريق السحب' : '2. موعد الحضور'}>
              <WindowPicker key={`${mode}-${effectiveBranch}`} slug={key} mode={mode} branchId={mode === 'BRANCH' ? effectiveBranch : null} horizon={data.laboratory.bookingHorizonDays} value={slot} onChange={setSlot} />
            </Section>
            <Section title="3. ملاحظات للمعمل (اختياري)">
              <TextField fullWidth multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: أتناول دواء سيولة" />
            </Section>
          </Stack>
        </Grid>
        <Grid xs={12} md={4}>
          <Card sx={{ p: 2, position: { md: 'sticky' }, top: { md: 88 } }}>
            <Typography variant="h6" sx={{ mb: 1 }}>ملخص الطلب</Typography>
            {!(selTests.length || selPkgs.length) && <Alert severity="warning" action={<Button component={RouterLink} to={`/providers/${data.provider.slug}`} color="inherit" size="small">اختيار</Button>}>لم تختر أي تحليل.</Alert>}
            <Stack spacing={0.75}>
              {selPkgs.map((p) => (
                <Stack key={p.id} direction="row" alignItems="center" spacing={1}>
                  <Typography sx={{ flex: 1 }}>{p.name}</Typography>
                  <Typography>{fmtMoney(p.price)}</Typography>
                  <IconButton size="small" aria-label="حذف" onClick={() => setPackages(packages.filter((x) => x !== p.id))}><DeleteOutline fontSize="small" /></IconButton>
                </Stack>
              ))}
              {selTests.map((t) => (
                <Stack key={t.id} direction="row" alignItems="center" spacing={1}>
                  <Typography sx={{ flex: 1 }}>{t.name}</Typography>
                  <Typography>{fmtMoney(t.price)}</Typography>
                  <IconButton size="small" aria-label="حذف" onClick={() => setTests(tests.filter((x) => x !== t.id))}><DeleteOutline fontSize="small" /></IconButton>
                </Stack>
              ))}
              {fee > 0 && <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">رسوم السحب المنزلي</Typography><Typography>{fmtMoney(fee)}</Typography></Stack>}
              <Divider />
              {isPatient && subtotal > 0 && (
                <CouponField serviceType="LAB" providerId={data.provider.id} amount={subtotal} value={activeCoupon} onChange={(v) => setCoupon(v ? { ...v, base: subtotal } : null)} />
              )}
              <DiscountLine discount={activeCoupon?.discount} />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>الإجمالي</Typography><Typography sx={{ fontWeight: 700, fontSize: 18 }}>{fmtMoney(subtotal + fee - (activeCoupon?.discount || 0))}</Typography></Stack>
              <Typography variant="caption" color="text.secondary">ادفع أونلاين بعد الحجز أو عند سحب العينة. السعر النهائي يُحسب من أسعار المعمل وقت الحجز.</Typography>
            </Stack>
            {slot && (
              <Box sx={{ mt: 1.5, p: 1.25, borderRadius: '10px', bgcolor: tokens.mint }}>
                <Typography sx={{ fontWeight: 600 }}>{fmtDate(slot.startAt)}</Typography>
                <Typography>{mode === 'HOME' ? `بين ${fmtTime(slot.startAt)} و ${fmtTime(slot.endAt)}` : fmtTime(slot.startAt)}</Typography>
              </Box>
            )}
            {!!prep.length && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>قبل الموعد:</Typography>
                {[...new Set(prep)].map((p) => <Typography key={p} variant="body2">• {p}</Typography>)}
              </Alert>
            )}
            {user ? (
              isPatient ? (
                <Button fullWidth size="large" variant="contained" sx={{ mt: 2 }} disabled={!canSubmit || book.isPending} onClick={submit}>
                  {book.isPending ? 'جاري الحجز…' : 'تأكيد الحجز'}
                </Button>
              ) : (
                <Alert severity="info" sx={{ mt: 2 }}>الحجز متاح لحسابات المرضى فقط.</Alert>
              )
            ) : (
              <Button fullWidth size="large" variant="contained" sx={{ mt: 2 }} component={RouterLink} to={`/login?next=${encodeURIComponent(`/labs/${key}/book?tests=${tests.join(',')}&packages=${packages.join(',')}`)}`}>
                سجّل الدخول لتأكيد الحجز
              </Button>
            )}
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
