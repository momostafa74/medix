import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
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
  Switch,
  FormControlLabel,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import MedicationOutlined from '@mui/icons-material/MedicationOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import AccessTime from '@mui/icons-material/AccessTime';
import { useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, fileUrl } from '../../api/client';
import { FULFILLMENT, medName, useMedicine, useMedicineSearch, usePharmacyItems, usePharmacyProfile } from '../../api/pharmacy';
import { CouponField, DiscountLine } from '../../components/payments/PayUi';
import { useAuth } from '../../auth/AuthProvider';
import FileUploadButton from '../../components/FileUploadButton';
import LocationSelect from '../../components/LocationSelect';
import { CartBar, useCart } from '../../components/pharmacy/Cart';
import { RxSheet, useCartTotals } from '../../components/pharmacy/PhUi';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Section, useDebounced } from '../../components/common';
import { DAYS, fmtMoney, fmtShortDate } from '../../utils/format';
import { tokens } from '../../theme';

const pharmacyRef = (p) => ({ key: p.slug || p.providerId, nameAr: p.nameAr, slug: p.slug });

function Qty({ value, onChange, size = 'small' }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ border: `1px solid ${tokens.line}`, borderRadius: '10px' }}>
      <IconButton size={size} aria-label="زيادة" onClick={() => onChange(value + 1)} disabled={value >= 50}><AddIcon fontSize="small" /></IconButton>
      <Typography sx={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{value}</Typography>
      <IconButton size={size} aria-label="تقليل" onClick={() => onChange(value - 1)}>{value === 1 ? <DeleteOutline fontSize="small" /> : <RemoveIcon fontSize="small" />}</IconButton>
    </Stack>
  );
}

function AddButton({ pharmacy, item }) {
  const cart = useCart();
  const q = cart.cart.pharmacy?.key === pharmacy.key ? cart.qtyOf(item.medicineId) : 0;
  if (q) return <Qty value={q} onChange={(v) => cart.setQty(item.medicineId, v)} />;
  return <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => cart.add(pharmacy, item)}>أضف</Button>;
}

// ─────────────── Medicine search & price comparison ───────────────

export function MedicinesSearch() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') || '');
  const [kind, setKind] = useState(params.get('kind') || '');
  const [category, setCategory] = useState('');
  const [available, setAvailable] = useState(true);
  const [loc, setLoc] = useState({});
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const { data: cats } = useQuery({ queryKey: ['medicines', 'categories'], queryFn: () => api.get('/medicines/categories').then((r) => r.data), staleTime: 300_000 });
  const { data, isLoading, error, refetch } = useMedicineSearch({ search, kind, category, available: available || undefined, cityId: loc.cityId, page, pageSize: 12 });
  const catList = (cats || []).filter((c) => !kind || c.kind === kind);
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1">الأدوية والصيدليات</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>ابحث عن دواء بالاسم التجاري أو المادة الفعالة، قارن أسعاره في الصيدليات واطلبه توصيل أو استلام.</Typography>
      <Stack spacing={1.5} sx={{ my: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField fullWidth placeholder="مثال: بنادول، Augmentin، Metformin" value={text} onChange={(e) => { setText(e.target.value); setPage(1); setParams(e.target.value ? { q: e.target.value } : {}, { replace: true }); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} inputProps={{ 'aria-label': 'ابحث عن دواء' }} />
          <ToggleButtonGroup exclusive size="small" value={kind} onChange={(_, v) => { setKind(v ?? ''); setCategory(''); setPage(1); }}>
            <ToggleButton value="">الكل</ToggleButton>
            <ToggleButton value="MEDICINE">أدوية</ToggleButton>
            <ToggleButton value="PRODUCT">منتجات</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <TextField select size="small" label="القسم" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} sx={{ minWidth: 220 }}>
            <MenuItem value="">كل الأقسام</MenuItem>
            {catList.map((c) => <MenuItem key={`${c.kind}-${c.category}`} value={c.category}>{c.category} ({c.count})</MenuItem>)}
          </TextField>
          <Box sx={{ flex: 1 }}><LocationSelect value={loc} onChange={(v) => { setLoc(v); setPage(1); }} /></Box>
          <FormControlLabel control={<Switch checked={available} onChange={(e) => { setAvailable(e.target.checked); setPage(1); }} />} label="المتوفر فقط" />
        </Stack>
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? <ListSkeleton rows={4} height={84} /> : data?.items.length ? (
        <Grid container spacing={1.5}>
          {data.items.map((m) => (
            <Grid key={m.id} xs={12} md={6}>
              <Card component={RouterLink} to={`/medicines/${m.id}${loc.cityId ? `?city=${loc.cityId}` : ''}`} sx={{ p: 2, display: 'block', textDecoration: 'none', color: 'inherit', height: '100%', '&:hover': { borderColor: tokens.petrol } }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Avatar variant="rounded" sx={{ bgcolor: m.kind === 'PRODUCT' ? tokens.saffronSoft : tokens.mint, color: tokens.petrol }}><MedicationOutlined /></Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }} noWrap dir="ltr" textAlign="right">{medName(m)}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>{[m.nameAr, m.genericName].filter(Boolean).join(' • ')}</Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      {m.requiresPrescription && <Chip size="small" color="warning" variant="outlined" label="بروشتة" />}
                      {m.category && <Chip size="small" variant="outlined" label={m.category} />}
                    </Stack>
                  </Box>
                  <Box sx={{ textAlign: 'left', flexShrink: 0 }}>
                    {m.offers ? (
                      <>
                        <Typography variant="caption" color="text.secondary">يبدأ من</Typography>
                        <Typography sx={{ fontWeight: 700, color: tokens.petrol }}>{fmtMoney(m.minPrice)}</Typography>
                        <Typography variant="caption" color="text.secondary">{m.offers} صيدلية</Typography>
                      </>
                    ) : <Typography variant="caption" color="text.secondary">غير متوفر حالياً</Typography>}
                  </Box>
                </Stack>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <EmptyState icon={<MedicationOutlined />} title="لم نجد نتائج" body="جرّب الاسم العلمي للدواء أو اسماً تجارياً آخر، أو ألغِ فلتر «المتوفر فقط»." />
      )}
      {data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 3 }}><Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" /></Stack>}
    </Container>
  );
}

export function MedicineDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [loc, setLoc] = useState({ cityId: params.get('city') || undefined });
  const { data, isLoading, error, refetch } = useMedicine(id, loc.cityId);
  if (error) return <Container sx={{ py: 4 }}><ErrorState error={error} onRetry={refetch} /></Container>;
  if (isLoading) return <Container sx={{ py: 4 }}><Skeleton variant="rounded" height={300} /></Container>;
  const m = data.medicine;
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Button component={RouterLink} to="/medicines" sx={{ mb: 1 }}>→ كل الأدوية</Button>
      <Card sx={{ p: 3, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <Avatar variant="rounded" sx={{ width: 64, height: 64, bgcolor: tokens.mint, color: tokens.petrol }}><MedicationOutlined fontSize="large" /></Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" component="h1" dir="ltr" textAlign="right">{medName(m)}</Typography>
            <Typography color="text.secondary">{[m.nameAr, m.genericName, m.manufacturer].filter(Boolean).join(' • ')}</Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              {m.requiresPrescription ? <Chip size="small" color="warning" label="يُصرف بروشتة طبيب" /> : <Chip size="small" color="success" variant="outlined" label="بدون روشتة" />}
              {m.category && <Chip size="small" variant="outlined" label={m.category} />}
              {m.kind === 'PRODUCT' && <Chip size="small" variant="outlined" label="منتج" />}
            </Stack>
          </Box>
        </Stack>
        {m.requiresPrescription && <Alert severity="info" sx={{ mt: 2 }}>هذا الدواء يحتاج روشتة: عند إتمام الطلب اختر روشتة إلكترونية من طبيبك أو ارفع صورة الروشتة لتراجعها الصيدلية.</Alert>}
      </Card>
      <Section title={`أسعار الصيدليات (${data.offers.length})`} action={<Box sx={{ width: { xs: '100%', md: 420 } }}><LocationSelect value={loc} onChange={setLoc} /></Box>}>
        {data.offers.length ? (
          <Stack divider={<Divider flexItem />}>
            {data.offers.map((o, i) => {
              const p = o.pharmacy;
              const ref = pharmacyRef(p);
              return (
                <Stack key={p.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ py: 1.5 }}>
                  <Avatar variant="rounded" src={fileUrl(p.logoFileId) || undefined} sx={{ bgcolor: tokens.mint, color: tokens.petrol, fontWeight: 700 }}>{p.nameAr[0]}</Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography component={RouterLink} to={`/providers/${p.slug}`} sx={{ fontWeight: 700, color: 'inherit' }}>{p.nameAr}</Typography>
                      {i === 0 && data.offers.length > 1 && <Chip size="small" color="success" label="الأرخص" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {[p.area, p.city].filter(Boolean).join('، ')} • {p.is24Hours ? '24 ساعة' : p.openNow ? 'مفتوح الآن' : 'مغلق الآن'}
                      {' • '}
                      {p.deliveryAvailable ? `توصيل ${p.deliveryFee ? fmtMoney(p.deliveryFee) : 'مجاني'}${p.freeDeliveryOver ? ` (مجاني فوق ${fmtMoney(p.freeDeliveryOver)})` : ''} خلال ~${p.estimatedDeliveryMinutes} د` : 'استلام فقط'}
                    </Typography>
                    {o.lowStock && <Typography variant="caption" sx={{ color: tokens.saffron, fontWeight: 600 }}>كمية محدودة</Typography>}
                  </Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 18, minWidth: 90 }}>{fmtMoney(o.price)}</Typography>
                  <AddButton pharmacy={ref} item={{ medicineId: m.id, name: medName(m), price: o.price, requiresPrescription: m.requiresPrescription }} />
                </Stack>
              );
            })}
          </Stack>
        ) : <Typography color="text.secondary">لا توجد صيدلية توفره حالياً{loc.cityId ? ' في هذه المدينة' : ''}.</Typography>}
      </Section>
      {!!data.alternatives.length && (
        <Section title="بدائل بنفس المادة الفعالة" sx={{ mt: 2 }}>
          <Stack spacing={1}>
            {data.alternatives.map((a) => (
              <Stack key={a.id} component={RouterLink} to={`/medicines/${a.id}`} direction="row" justifyContent="space-between" sx={{ p: 1.25, borderRadius: '10px', border: `1px solid ${tokens.line}`, color: 'inherit', textDecoration: 'none' }}>
                <Box>
                  <Typography sx={{ fontWeight: 600 }} dir="ltr" textAlign="right">{medName(a)}</Typography>
                  <Typography variant="caption" color="text.secondary">{a.manufacturer}</Typography>
                </Box>
                <Typography sx={{ fontWeight: 600 }}>{a.minPrice != null ? `من ${fmtMoney(a.minPrice)}` : 'غير متوفر'}</Typography>
              </Stack>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>لا تستبدل دواءً بآخر إلا بعد استشارة طبيبك أو الصيدلي.</Typography>
        </Section>
      )}
      <CartBar />
    </Container>
  );
}

// ─────────────── Pharmacy store (inside the public pharmacy profile) ───────────────

const hoursText = (hours) => {
  if (!hours?.length) return null;
  const byDay = DAYS.map((d, i) => ({ d, b: hours.filter((h) => h.day === i) }));
  const t = (m) => (m >= 1440 ? '12:00 ص' : `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'ص' : 'م'}`);
  return byDay.filter((x) => x.b.length).map((x) => `${x.d}: من ${t(x.b[0].open)} إلى ${t(x.b[0].close)}`);
};

export function PharmacyCatalogSection({ slug }) {
  const { data, isLoading, error, refetch } = usePharmacyProfile(slug);
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(text);
  const nav = useNavigate();
  const cart = useCart();
  const items = usePharmacyItems(slug, { kind, category, search, page, pageSize: 12 });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton variant="rounded" height={300} />;
  const ph = data.pharmacy;
  const ref = pharmacyRef(data.provider);
  const cats = data.categories.filter((c) => !kind || c.kind === kind);
  const quote = async () => {
    if (await cart.ensurePharmacy(ref)) nav('/checkout?quote=1');
  };
  return (
    <>
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip icon={<AccessTime />} color={ph.openNow ? 'success' : 'default'} label={ph.is24Hours ? 'مفتوحة 24 ساعة' : ph.openNow ? 'مفتوحة الآن' : 'مغلقة الآن'} />
            {ph.deliveryAvailable ? (
              <Chip icon={<LocalShippingOutlined />} variant="outlined" label={`توصيل ${ph.deliveryFee ? fmtMoney(ph.deliveryFee) : 'مجاني'} • ~${ph.estimatedDeliveryMinutes} دقيقة`} />
            ) : <Chip icon={<StorefrontOutlined />} variant="outlined" label="استلام من الصيدلية فقط" />}
            {ph.deliveryAvailable && ph.freeDeliveryOver != null && <Chip variant="outlined" color="success" label={`توصيل مجاني فوق ${fmtMoney(ph.freeDeliveryOver)}`} />}
            {ph.deliveryAvailable && ph.minOrderForDelivery > 0 && <Chip variant="outlined" label={`أقل طلب للتوصيل ${fmtMoney(ph.minOrderForDelivery)}`} />}
          </Stack>
          {ph.deliveryAreasNote && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{ph.deliveryAreasNote}</Typography>}
        </Grid>
        <Grid xs={12} md={4}>
          <Card sx={{ p: 2, bgcolor: tokens.mint, borderColor: tokens.mint }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <ReceiptLongOutlined sx={{ color: tokens.petrol }} />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>معاك روشتة؟</Typography>
                <Typography variant="body2" color="text.secondary">ارفع صورتها أو اختر روشتتك الإلكترونية وتسعّرها الصيدلية.</Typography>
              </Box>
            </Stack>
            <Button fullWidth variant="contained" sx={{ mt: 1.5 }} onClick={quote}>اطلب بالروشتة</Button>
          </Card>
        </Grid>
      </Grid>
      <Card sx={{ p: 2, mt: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <TextField size="small" fullWidth placeholder={`ابحث في ${data.counts.medicines + data.counts.products} صنف`} value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
          <ToggleButtonGroup exclusive size="small" value={kind} onChange={(_, v) => { setKind(v ?? ''); setCategory(''); setPage(1); }}>
            <ToggleButton value="">الكل</ToggleButton>
            <ToggleButton value="MEDICINE">أدوية ({data.counts.medicines})</ToggleButton>
            <ToggleButton value="PRODUCT">منتجات ({data.counts.products})</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {!!cats.length && (
          <Stack direction="row" spacing={0.75} sx={{ mb: 2, overflowX: 'auto', pb: 0.5 }}>
            <Chip label="الكل" color={!category ? 'primary' : 'default'} onClick={() => { setCategory(''); setPage(1); }} />
            {cats.map((c) => <Chip key={`${c.kind}${c.category}`} label={c.category} color={category === c.category ? 'primary' : 'default'} variant={category === c.category ? 'filled' : 'outlined'} onClick={() => { setCategory(c.category); setPage(1); }} />)}
          </Stack>
        )}
        {items.isLoading ? <ListSkeleton rows={4} height={64} /> : items.data?.items.length ? (
          <Grid container spacing={1.25}>
            {items.data.items.map((it) => {
              const m = it.medicine;
              return (
                <Grid key={it.id} xs={12} sm={6} lg={4}>
                  <Box sx={{ p: 1.5, border: `1px solid ${tokens.line}`, borderRadius: '12px', height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography component={RouterLink} to={`/medicines/${m.id}`} sx={{ fontWeight: 700, color: 'inherit', textDecoration: 'none', display: 'block' }} dir="ltr" textAlign="right">{medName(m)}</Typography>
                      <Typography variant="caption" color="text.secondary">{[m.nameAr, m.genericName].filter(Boolean).join(' • ')}</Typography>
                    </Box>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography sx={{ fontWeight: 700, color: tokens.petrol }}>{fmtMoney(it.price)}</Typography>
                        <Stack direction="row" spacing={0.5}>
                          {m.requiresPrescription && <Chip size="small" color="warning" variant="outlined" label="بروشتة" />}
                          {it.lowStock && <Chip size="small" variant="outlined" label="كمية محدودة" />}
                        </Stack>
                      </Box>
                      <AddButton pharmacy={ref} item={{ medicineId: m.id, name: medName(m), price: it.price, requiresPrescription: m.requiresPrescription }} />
                    </Stack>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        ) : <EmptyState title="لا توجد أصناف مطابقة" body="جرّب كلمة أخرى، أو اطلب بالروشتة لتوفرها الصيدلية لك." />}
        {items.data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 2 }}><Pagination count={items.data.totalPages} page={page} onChange={(_, p) => setPage(p)} /></Stack>}
      </Card>
      {data.branches.some((b) => b.openingHours?.length) && !ph.is24Hours && (
        <Section title="مواعيد العمل" sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            {data.branches.map((b) => (
              <Grid key={b.id} xs={12} md={6}>
                <Stack direction="row" spacing={1} alignItems="center"><Typography sx={{ fontWeight: 600 }}>{b.name}</Typography>{b.openNow ? <Chip size="small" color="success" label="مفتوح" /> : <Chip size="small" label="مغلق" />}</Stack>
                {(hoursText(b.openingHours) || ['غير محدد']).map((l) => <Typography key={l} variant="body2" color="text.secondary">{l}</Typography>)}
              </Grid>
            ))}
          </Grid>
        </Section>
      )}
      <CartBar pharmacyKey={ref.key} />
    </>
  );
}

// ─────────────── Checkout ───────────────

export function Checkout() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { enqueueSnackbar } = useSnackbar();
  const cart = useCart();
  const key = cart.cart.pharmacy?.key;
  const { data: profile, isLoading } = usePharmacyProfile(key);
  const { data: me } = useQuery({ queryKey: ['patients', 'me'], queryFn: () => api.get('/patients/me').then((r) => r.data), enabled: !!user?.patientId });
  const { data: myRx } = useQuery({ queryKey: ['prescriptions', 'mine', 'active'], queryFn: () => api.get('/prescriptions/mine?pageSize=50').then((r) => r.data.items.filter((x) => x.state === 'ACTIVE')), enabled: !!user?.patientId });
  const [fulfillment, setFulfillment] = useState('DELIVERY');
  const [branchId, setBranchId] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [upload, setUpload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState(null);
  const rxId = cart.cart.prescriptionId || '';
  const { data: rx } = useQuery({ queryKey: ['prescriptions', rxId], queryFn: () => api.get(`/prescriptions/${rxId}`).then((r) => r.data), enabled: !!rxId });

  useEffect(() => {
    if (me) {
      setAddress((a) => a || me.address || '');
      setPhone((p) => p || me.user?.phone || '');
    }
  }, [me]);
  useEffect(() => {
    if (profile) {
      if (!profile.pharmacy.deliveryAvailable) setFulfillment('PICKUP');
      setBranchId((b) => b || profile.branches[0]?.id || '');
    }
  }, [profile]);
  const totals = useCartTotals(cart.cart.lines, profile?.pharmacy, fulfillment);

  if (!user?.patientId) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <EmptyState title="سجّل الدخول كمريض لإتمام الطلب" action={<Button variant="contained" component={RouterLink} to="/login?next=/checkout">تسجيل الدخول</Button>} />
      </Container>
    );
  }
  if (!key) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <EmptyState icon={<MedicationOutlined />} title="السلة فارغة" body="ابحث عن الدواء وقارن الأسعار، أو اختر صيدلية واطلب بالروشتة." action={<Button variant="contained" component={RouterLink} to="/medicines">ابحث عن دواء</Button>} />
      </Container>
    );
  }
  const lines = cart.cart.lines;
  const needsRx = lines.filter((l) => l.requiresPrescription);
  const prescribed = new Set((rx?.items || []).map((i) => i.medicineId).filter(Boolean));
  const uncovered = upload ? [] : needsRx.filter((l) => !prescribed.has(l.medicineId));
  const quote = !lines.length;
  // Discount applies to the medicines only; re-checked by the pharmacy's confirmed prices.
  const activeCoupon = coupon && !quote && coupon.base === totals.subtotal ? coupon : null;
  const canSubmit = !busy && (lines.length || rxId || upload) && !uncovered.length && !(fulfillment === 'DELIVERY' && (!address.trim() || address.trim().length < 8)) && !(lines.length && totals.blocked) && !(fulfillment === 'DELIVERY' && profile && !profile.pharmacy.deliveryAvailable);
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/pharmacy-orders', {
        pharmacy: key,
        items: lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity })),
        prescriptionId: rxId || undefined,
        prescriptionFileId: upload?.id,
        fulfillment,
        branchId: fulfillment === 'PICKUP' ? branchId || undefined : undefined,
        deliveryAddress: fulfillment === 'DELIVERY' ? address : undefined,
        contactPhone: phone || undefined,
        notes: notes || undefined,
        couponCode: activeCoupon?.code,
      });
      cart.clear();
      enqueueSnackbar('تم إرسال طلبك للصيدلية', { variant: 'success' });
      nav(`/patient/pharmacy-orders/${data.id}`);
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageHeader title="إتمام الطلب" subtitle={cart.cart.pharmacy.nameAr} actions={<Button component={RouterLink} to={`/providers/${cart.cart.pharmacy.slug || key}`}>إضافة أصناف أخرى</Button>} />
      {isLoading ? <Skeleton variant="rounded" height={300} /> : (
        <Grid container spacing={2}>
          <Grid xs={12} md={7}>
            <Stack spacing={2}>
              <Section title={quote ? 'طلب تسعير روشتة' : `الأصناف (${lines.length})`}>
                {quote ? (
                  <Typography color="text.secondary">لم تضف أصنافاً — سترسل الروشتة للصيدلية لتسعيرها وتأكيد المتوفر، ويصلك الإجمالي قبل التجهيز.</Typography>
                ) : (
                  <Stack divider={<Divider flexItem />}>
                    {lines.map((l) => (
                      <Stack key={l.medicineId} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 600 }} dir="auto">{l.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{fmtMoney(l.price)} للعبوة{l.requiresPrescription ? ' • بروشتة' : ''}</Typography>
                          {uncovered.some((u) => u.medicineId === l.medicineId) && <Typography variant="caption" sx={{ display: 'block', color: tokens.signal }}>يحتاج روشتة تتضمنه</Typography>}
                        </Box>
                        <Qty value={l.quantity} onChange={(v) => cart.setQty(l.medicineId, v)} />
                        <Typography sx={{ fontWeight: 700, minWidth: 80, textAlign: 'left' }}>{fmtMoney(l.price * l.quantity)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Section>
              <Section title="الروشتة">
                <Stack spacing={1.5}>
                  <TextField select size="small" label="روشتة إلكترونية من طبيبك" value={rxId} onChange={(e) => cart.setPrescription(e.target.value || null)} helperText={myRx && !myRx.length ? 'لا توجد روشتات سارية في حسابك' : 'تظهر الروشتات السارية التي كتبها لك أطباء المنصة'}>
                    <MenuItem value="">بدون</MenuItem>
                    {(myRx || []).map((r) => <MenuItem key={r.id} value={r.id}>{fmtShortDate(r.issuedAt)} — د. {r.doctorName} — {r.medicines.slice(0, 2).join('، ')}</MenuItem>)}
                  </TextField>
                  {rx && <RxSheet rx={rx} compact />}
                  <Stack direction="row" spacing={1} alignItems="center">
                    <FileUploadButton purpose="PRESCRIPTION_UPLOAD" label={upload ? 'تغيير صورة الروشتة' : 'رفع صورة روشتة ورقية'} variant="outlined" onUploaded={setUpload} />
                    {upload && <Chip label={upload.originalName} onDelete={() => setUpload(null)} />}
                  </Stack>
                  {needsRx.length > 0 && !rxId && !upload && <Alert severity="warning">في سلتك أدوية تُصرف بروشتة ({needsRx.map((l) => l.name).join('، ')}). اختر روشتة إلكترونية تتضمنها أو ارفع صورة الروشتة.</Alert>}
                  {rx && uncovered.length > 0 && <Alert severity="warning">الروشتة المختارة لا تتضمن: {uncovered.map((l) => l.name).join('، ')}. ارفع صورة روشتة أخرى أو احذفها من السلة.</Alert>}
                </Stack>
              </Section>
              <Section title="الاستلام">
                <ToggleButtonGroup exclusive fullWidth value={fulfillment} onChange={(_, v) => v && setFulfillment(v)} sx={{ mb: 2 }}>
                  <ToggleButton value="DELIVERY" disabled={!profile?.pharmacy.deliveryAvailable}><LocalShippingOutlined sx={{ ml: 1 }} />{FULFILLMENT.DELIVERY}</ToggleButton>
                  <ToggleButton value="PICKUP"><StorefrontOutlined sx={{ ml: 1 }} />{FULFILLMENT.PICKUP}</ToggleButton>
                </ToggleButtonGroup>
                {fulfillment === 'DELIVERY' ? (
                  <TextField fullWidth multiline minRows={2} label="عنوان التوصيل بالتفصيل" value={address} onChange={(e) => setAddress(e.target.value)} helperText="الشارع، رقم العمارة، الدور، علامة مميزة" />
                ) : (
                  <TextField fullWidth select label="الفرع" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    {profile?.branches.map((b) => <MenuItem key={b.id} value={b.id}>{b.name} — {b.address}</MenuItem>)}
                  </TextField>
                )}
                <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                  <Grid xs={12} sm={5}><TextField fullWidth label="رقم التواصل" value={phone} onChange={(e) => setPhone(e.target.value)} inputProps={{ dir: 'ltr' }} /></Grid>
                  <Grid xs={12} sm={7}><TextField fullWidth label="ملاحظات للصيدلية (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} /></Grid>
                </Grid>
              </Section>
            </Stack>
          </Grid>
          <Grid xs={12} md={5}>
            <Card sx={{ p: 2.5, position: { md: 'sticky' }, top: 88 }}>
              <Typography variant="h6" sx={{ mb: 1.5 }}>ملخص الطلب</Typography>
              <Stack spacing={0.75}>
                <Stack direction="row" justifyContent="space-between"><Typography>الأصناف</Typography><Typography>{quote ? 'تحدده الصيدلية' : fmtMoney(totals.subtotal)}</Typography></Stack>
                {fulfillment === 'DELIVERY' && <Stack direction="row" justifyContent="space-between"><Typography>التوصيل</Typography><Typography>{totals.deliveryFee ? fmtMoney(totals.deliveryFee) : quote ? fmtMoney(profile?.pharmacy.deliveryFee) : 'مجاني'}</Typography></Stack>}
                <DiscountLine discount={activeCoupon?.discount} />
                <Divider />
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>الإجمالي التقريبي</Typography><Typography sx={{ fontWeight: 700 }}>{quote ? '—' : fmtMoney(totals.total - (activeCoupon?.discount || 0))}</Typography></Stack>
                {!quote && profile && totals.subtotal > 0 && (
                  <Box sx={{ pt: 1 }}>
                    <CouponField serviceType="PHARMACY" providerId={profile.provider.id} amount={totals.subtotal} value={activeCoupon} onChange={(v) => setCoupon(v ? { ...v, base: totals.subtotal } : null)} />
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary">بعد تأكيد الصيدلية للأسعار تقدر تدفع أونلاين من صفحة الطلب، أو نقداً عند الاستلام.</Typography>
              </Stack>
              {lines.length > 0 && totals.blocked && <Alert severity="warning" sx={{ mt: 1.5 }}>{totals.blocked}</Alert>}
              <Button fullWidth size="large" variant="contained" sx={{ mt: 2 }} disabled={!canSubmit} onClick={submit}>{busy ? 'جاري الإرسال…' : quote ? 'أرسل الروشتة للتسعير' : 'تأكيد الطلب'}</Button>
              {params.get('quote') && quote && !rxId && !upload && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>اختر روشتة إلكترونية أو ارفع صورة الروشتة أولاً.</Typography>}
              <Button fullWidth color="inherit" sx={{ mt: 1 }} onClick={cart.clear}>تفريغ السلة</Button>
            </Card>
          </Grid>
        </Grid>
      )}
    </Container>
  );
}

