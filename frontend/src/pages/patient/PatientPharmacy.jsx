import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Avatar, Box, Button, Card, Dialog, DialogContent, DialogTitle, Divider, Pagination, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ArrowForward from '@mui/icons-material/ArrowForward';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import LocalPharmacyOutlined from '@mui/icons-material/LocalPharmacyOutlined';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, fileUrl } from '../../api/client';
import { FULFILLMENT, PH_STATUS, downloadRx, usePhOrder, usePhOrders, usePrescription, usePrescriptions } from '../../api/pharmacy';
import { useRealtime } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Section } from '../../components/common';
import { HistoryList } from '../../components/lab/LabUi';
import { PaymentPanel } from '../../components/payments/PayUi';
import ReasonDialog from '../../components/lab/ReasonDialog';
import ProtectedFile from '../../components/ProtectedFile';
import ChatButton from '../../components/ChatButton';
import { useCart } from '../../components/pharmacy/Cart';
import { OrderLines, PhStatusChip, PhTrack, RxSheet, RxStateChip } from '../../components/pharmacy/PhUi';
import { fmtDateTime, fmtMoney, fmtShortDate } from '../../utils/format';
import { whatsappLink } from '../../utils/whatsapp';
import { tokens } from '../../theme';

// ─────────────── Prescriptions ───────────────

export function PatientPrescriptions() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = usePrescriptions('patient', { page, pageSize: 10 });
  return (
    <>
      <PageHeader title="روشتاتي" subtitle="الروشتات الإلكترونية من أطبائك — اعرضها، اطبعها، أو اطلبها من الصيدلية الأقرب أو الأرخص." />
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? <ListSkeleton rows={3} height={96} /> : data?.items.length ? (
        <Stack spacing={1.5}>
          {data.items.map((rx) => (
            <Card key={rx.id} component={RouterLink} to={`/patient/prescriptions/${rx.id}`} sx={{ p: 2, textDecoration: 'none', color: 'inherit', '&:hover': { borderColor: tokens.petrol } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>{rx.diagnosis || 'روشتة'}</Typography>
                  <Typography variant="body2" color="text.secondary">د. {rx.doctorName} • {fmtShortDate(rx.issuedAt)} • <span dir="ltr">{rx.code}</span></Typography>
                  <Typography variant="body2" noWrap dir="auto">{rx.medicines.join('، ')}</Typography>
                </Box>
                <Stack alignItems={{ sm: 'flex-end' }} spacing={0.5}>
                  <RxStateChip value={rx.state} />
                  {rx.state === 'ACTIVE' && rx.validUntil && <Typography variant="caption" color="text.secondary">صالحة حتى {fmtShortDate(rx.validUntil)}</Typography>}
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : (
        <EmptyState icon={<ReceiptLongOutlined />} title="لا توجد روشتات بعد" body="عندما يكتب لك طبيب على المنصة روشتة إلكترونية تظهر هنا فوراً." action={<Button variant="outlined" component={RouterLink} to="/doctors">احجز مع طبيب</Button>} />
      )}
      {data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 2 }}><Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} /></Stack>}
    </>
  );
}

function PharmacyOffersDialog({ rx, open, onClose }) {
  const cart = useCart();
  const nav = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ['rx-offers', rx.id], queryFn: () => api.get(`/pharmacy-orders/prescription-offers/${rx.id}`).then((r) => r.data), enabled: open });
  const choose = (o) => {
    cart.replace(
      { key: o.pharmacy.slug, nameAr: o.pharmacy.nameAr, slug: o.pharmacy.slug },
      o.items.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity, price: l.unitPrice, name: l.name, requiresPrescription: l.requiresPrescription })),
      rx.id,
    );
    nav('/checkout');
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>اختر الصيدلية</DialogTitle>
      <DialogContent dividers>
        {error && <ErrorState error={error} />}
        {isLoading ? <Skeleton variant="rounded" height={200} /> : data && (
          <Stack spacing={1.25}>
            {!!data.prescription.freeText.length && <Alert severity="info">أدوية مكتوبة بالاسم ({data.prescription.freeText.join('، ')}) تسعّرها الصيدلية عند التأكيد.</Alert>}
            {!data.pharmacies.length && <Typography color="text.secondary">لا توجد صيدلية توفر أدوية هذه الروشتة حالياً. يمكنك اختيار أي صيدلية وطلب تسعير الروشتة.</Typography>}
            {data.pharmacies.map((o) => (
              <Box key={o.pharmacy.id} sx={{ p: 1.5, borderRadius: '12px', border: `1px solid ${o.available === data.prescription.items ? tokens.success : tokens.line}` }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Avatar variant="rounded" src={fileUrl(o.pharmacy.logoFileId) || undefined} sx={{ bgcolor: tokens.mint, color: tokens.petrol }}>{o.pharmacy.nameAr[0]}</Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }}>{o.pharmacy.nameAr}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[o.pharmacy.area, o.pharmacy.city].filter(Boolean).join('، ')} • {o.deliveryAvailable ? `توصيل ${o.deliveryFee ? fmtMoney(o.deliveryFee) : 'مجاني'}` : 'استلام فقط'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: o.available === data.prescription.items ? 'success.main' : tokens.saffron, fontWeight: 600 }}>
                      {o.available === data.prescription.items ? 'كل الأدوية متوفرة' : `متوفر ${o.available} من ${data.prescription.items}`}
                    </Typography>
                    {!!o.missing.length && <Typography variant="caption" color="text.secondary">غير متوفر: {o.missing.join('، ')}</Typography>}
                  </Box>
                  <Stack alignItems="flex-end" spacing={0.5}>
                    <Typography sx={{ fontWeight: 700 }}>{fmtMoney(o.subtotal)}</Typography>
                    <Button size="small" variant="contained" onClick={() => choose(o)}>اطلب</Button>
                  </Stack>
                </Stack>
              </Box>
            ))}
            <Typography variant="caption" color="text.secondary">السعر للكميات المكتوبة في الروشتة (عبوة واحدة إن لم يحددها الطبيب). يمكنك تعديل الكميات في الخطوة التالية.</Typography>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PatientPrescriptionDetail() {
  const { id } = useParams();
  const { enqueueSnackbar } = useSnackbar();
  const { data: rx, isLoading, error, refetch } = usePrescription(id);
  const [offers, setOffers] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={3} height={140} />;
  const pdf = async (print) => {
    setBusy(true);
    try {
      if (print) {
        const res = await api.get(`/prescriptions/${id}/pdf`, { responseType: 'blob' });
        const url = URL.createObjectURL(res.data);
        const w = window.open(url, '_blank', 'noopener');
        if (!w) enqueueSnackbar('اسمح بالنوافذ المنبثقة للطباعة', { variant: 'info' });
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else await downloadRx(rx);
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button component={RouterLink} to="/patient/prescriptions" startIcon={<ArrowForward />} sx={{ mb: 1 }}>كل الروشتات</Button>
      <PageHeader
        title={rx.diagnosis || 'روشتة إلكترونية'}
        subtitle={`د. ${rx.doctor.fullName} • ${fmtShortDate(rx.issuedAt)}`}
        actions={[
          rx.can.order && <Button key="o" variant="contained" startIcon={<LocalPharmacyOutlined />} onClick={() => setOffers(true)}>اطلب من صيدلية</Button>,
          <Button key="pdf" variant="outlined" startIcon={<PictureAsPdfOutlined />} disabled={busy} onClick={() => pdf(false)}>تحميل PDF</Button>,
          <Button key="print" startIcon={<PrintOutlined />} disabled={busy} onClick={() => pdf(true)}>طباعة</Button>,
          <ChatButton key="chat" payload={{ type: 'PATIENT_PROVIDER', providerId: rx.doctor.providerId }} label="مراسلة الطبيب" />,
        ].filter(Boolean)}
      />
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          <RxSheet rx={rx} />
        </Grid>
        <Grid xs={12} md={4}>
          <Stack spacing={2}>
            <Section title="للصيدلي">
              <Typography variant="body2" color="text.secondary">يمسح الصيدلي رمز QR على الروشتة المطبوعة أو يكتب كود التحقق ليتأكد منها ويسجل صرفها. تُصرف الروشتة مرة واحدة فقط.</Typography>
              {rx.verificationCode && <Typography sx={{ mt: 1, fontFamily: 'monospace', bgcolor: tokens.paper, p: 1, borderRadius: '8px', textAlign: 'center' }} dir="ltr">{rx.verificationCode}</Typography>}
            </Section>
            {!!rx.orders?.length && (
              <Section title="طلبات الصيدلية">
                <Stack spacing={1}>
                  {rx.orders.map((o) => (
                    <Stack key={o.id} component={RouterLink} to={`/patient/pharmacy-orders/${o.id}`} direction="row" justifyContent="space-between" sx={{ color: 'inherit', textDecoration: 'none' }}>
                      <Typography variant="body2">{o.pharmacyName} • <span dir="ltr">{o.code}</span></Typography>
                      <PhStatusChip value={o.status} />
                    </Stack>
                  ))}
                </Stack>
              </Section>
            )}
          </Stack>
        </Grid>
      </Grid>
      {rx.can.order && <PharmacyOffersDialog rx={rx} open={offers} onClose={() => setOffers(false)} />}
    </>
  );
}

// ─────────────── Pharmacy orders ───────────────

const TABS = { open: 'PENDING,CONFIRMED,PREPARING,READY,OUT_FOR_DELIVERY', done: 'DELIVERED', closed: 'CANCELLED' };

export function PatientPharmacyOrders() {
  const [tab, setTab] = useState('open');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  useRealtime('pharmacy:order', () => qc.invalidateQueries({ queryKey: ['pharmacy-orders'] }));
  const { data, isLoading, error, refetch } = usePhOrders('patient', { status: TABS[tab], page, pageSize: 10 });
  return (
    <>
      <PageHeader title="طلبات الصيدلية" subtitle="تابع طلبك من التأكيد حتى التوصيل لحظة بلحظة." actions={<Button variant="contained" component={RouterLink} to="/medicines">اطلب دواء</Button>} />
      <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(1); }} sx={{ mb: 2 }}>
        <Tab value="open" label="جارية" />
        <Tab value="done" label="تم التسليم" />
        <Tab value="closed" label="ملغاة" />
      </Tabs>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? <ListSkeleton rows={3} height={110} /> : data?.items.length ? (
        <Stack spacing={1.5}>
          {data.items.map((o) => (
            <Card key={o.id} component={RouterLink} to={`/patient/pharmacy-orders/${o.id}`} sx={{ p: 2, textDecoration: 'none', color: 'inherit', '&:hover': { borderColor: tokens.petrol } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>{o.pharmacy.nameAr}</Typography>
                  <Typography variant="body2" color="text.secondary" noWrap dir="auto">{o.summary || 'طلب تسعير روشتة'}</Typography>
                  <Typography variant="body2">{fmtDateTime(o.createdAt)} • {FULFILLMENT[o.fulfillment]}</Typography>
                </Box>
                <Stack alignItems={{ sm: 'flex-end' }} spacing={0.5}>
                  <PhStatusChip value={o.status} />
                  <Typography sx={{ fontWeight: 600 }}>{o.items ? fmtMoney(o.total) : 'بانتظار التسعير'}</Typography>
                </Stack>
              </Stack>
              {tab === 'open' && <PhTrack status={o.status} fulfillment={o.fulfillment} />}
            </Card>
          ))}
        </Stack>
      ) : (
        <EmptyState icon={<LocalPharmacyOutlined />} title={tab === 'open' ? 'لا توجد طلبات جارية' : 'لا توجد طلبات'} body="ابحث عن دوائك وقارن الأسعار في الصيدليات القريبة." action={<Button variant="outlined" component={RouterLink} to="/medicines">ابحث عن دواء</Button>} />
      )}
      {data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 2 }}><Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} /></Stack>}
    </>
  );
}

export function PatientPharmacyOrderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const cart = useCart();
  const { enqueueSnackbar } = useSnackbar();
  const { data: o, isLoading, error, refetch } = usePhOrder(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  useRealtime('pharmacy:order', (e) => e.id === id && qc.invalidateQueries({ queryKey: ['pharmacy-orders', id] }));
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={3} height={140} />;
  const wa = whatsappLink(o.pharmacy.whatsappNumber, { doctorName: o.pharmacy.nameAr });
  const reorder = () => {
    cart.replace({ key: o.pharmacy.slug, nameAr: o.pharmacy.nameAr, slug: o.pharmacy.slug }, o.items.map((i) => ({ medicineId: i.medicineId, name: i.name, price: i.unitPrice, quantity: i.quantity, requiresPrescription: !!i.requiresPrescription })));
    nav('/checkout');
  };
  return (
    <>
      <Button component={RouterLink} to="/patient/pharmacy-orders" startIcon={<ArrowForward />} sx={{ mb: 1 }}>كل الطلبات</Button>
      <PageHeader
        title={o.pharmacy.nameAr}
        subtitle={`${FULFILLMENT[o.fulfillment]} • ${o.code}`}
        actions={[
          o.can.chat && <ChatButton key="chat" payload={{ type: 'PATIENT_PROVIDER', providerId: o.pharmacy.providerId }} label="مراسلة الصيدلية" variant="outlined" />,
          wa && <Button key="wa" variant="outlined" color="success" href={wa} target="_blank" rel="noopener noreferrer">واتساب</Button>,
          o.can.reorder && <Button key="re" variant="contained" onClick={reorder}>اطلب مرة أخرى</Button>,
          o.can.cancel && <Button key="c" color="error" onClick={() => setCancelOpen(true)}>إلغاء الطلب</Button>,
        ].filter(Boolean)}
      />
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
          <PhStatusChip value={o.status} size="medium" />
          {o.status === 'OUT_FOR_DELIVERY' && o.driverName && (
            <Stack direction="row" spacing={1} alignItems="center">
              <LocalShippingOutlined color="primary" />
              <Typography>{o.driverName}</Typography>
              {o.driverPhone && <Button size="small" startIcon={<PhoneOutlined />} href={`tel:${o.driverPhone}`} dir="ltr">{o.driverPhone}</Button>}
            </Stack>
          )}
          {o.cancelReason && <Typography color="text.secondary">السبب: {o.cancelReason}</Typography>}
        </Stack>
        <PhTrack status={o.status} fulfillment={o.fulfillment} />
        {o.status === 'PENDING' && <Typography variant="body2" color="text.secondary">بانتظار تأكيد الصيدلية{o.quote ? ' وتسعير الروشتة' : ''}. يصلك إشعار فور التأكيد.</Typography>}
        {o.status === 'READY' && o.fulfillment === 'PICKUP' && <Alert severity="success" sx={{ mt: 1 }}>طلبك جاهز للاستلام من {o.branch?.name} — {o.branch?.address}</Alert>}
      </Card>
      <Grid container spacing={2}>
        <Grid xs={12} md={7}>
          <Stack spacing={2}>
            {o.pharmacistNote && <Alert severity="info">ملاحظة الصيدلي: {o.pharmacistNote}</Alert>}
            <Section title="الأصناف">
              {o.items.length ? <OrderLines items={o.items} subtotal={o.subtotal} deliveryFee={o.deliveryFee} total={o.total} fulfillment={o.fulfillment} discount={o.discount} /> : <Typography color="text.secondary">الصيدلية تراجع الروشتة وتحدد الأصناف والأسعار.</Typography>}
              <Typography variant="body2" color={o.paymentStatus === 'PAID' ? 'success.main' : 'text.secondary'} sx={{ mt: 1 }}>{o.paymentStatus === 'PAID' ? 'تم الدفع' : o.paymentStatus === 'REFUNDED' ? 'تم استرداد المبلغ' : o.status === 'PENDING' ? 'بعد تأكيد الصيدلية للسعر تقدر تدفع أونلاين أو نقداً عند الاستلام' : 'غير مدفوع بعد'}</Typography>
            </Section>
            {o.prescription && (
              <Section title="الروشتة المرفقة" action={<Button size="small" component={RouterLink} to={`/patient/prescriptions/${o.prescription.id}`}>عرض</Button>}>
                <Stack direction="row" spacing={1} alignItems="center"><Typography variant="body2">د. {o.prescription.doctorName} • {fmtShortDate(o.prescription.issuedAt)}</Typography><RxStateChip value={o.prescription.state} /></Stack>
              </Section>
            )}
            {o.prescriptionFileId && <Section title="صورة الروشتة"><ProtectedFile fileId={o.prescriptionFileId} label="عرض الصورة" /></Section>}
          </Stack>
        </Grid>
        <Grid xs={12} md={5}>
          <Stack spacing={2}>
            <Section title={o.fulfillment === 'DELIVERY' ? 'التوصيل' : 'الاستلام'}>
              {o.fulfillment === 'DELIVERY' ? (
                <>
                  <Typography>{o.deliveryAddress}</Typography>
                  <Typography variant="body2" color="text.secondary">الوقت المتوقع ~{o.pharmacy.estimatedDeliveryMinutes} دقيقة بعد التجهيز</Typography>
                </>
              ) : (
                <>
                  <Typography sx={{ fontWeight: 600 }}>{o.branch?.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{o.branch?.address}</Typography>
                </>
              )}
              {o.contactPhone && <Typography variant="body2" sx={{ mt: 1 }}>رقم التواصل: <span dir="ltr">{o.contactPhone}</span></Typography>}
              {o.notes && <Typography variant="body2" sx={{ mt: 1 }}>ملاحظاتك: {o.notes}</Typography>}
            </Section>
            {o.status !== 'PENDING' && <PaymentPanel entityType="PHARMACY_ORDER" entityId={o.id} note="الدفع نقداً عند الاستلام." />}
            <Section title="سجل الطلب"><HistoryList history={o.history} labels={PH_STATUS} /></Section>
          </Stack>
        </Grid>
      </Grid>
      <Divider sx={{ my: 2, opacity: 0 }} />
      <ReasonDialog open={cancelOpen} title="إلغاء الطلب" body="يمكن الإلغاء قبل بدء التجهيز فقط." label="السبب (اختياري)" confirmText="إلغاء الطلب" danger onClose={() => setCancelOpen(false)}
        onSubmit={async (reason) => {
          try {
            await api.post(`/pharmacy-orders/${id}/cancel`, { reason: reason || undefined });
            enqueueSnackbar('تم إلغاء الطلب', { variant: 'success' });
            qc.invalidateQueries({ queryKey: ['pharmacy-orders'] });
          } catch (e) {
            enqueueSnackbar(errorMessage(e), { variant: 'error' });
            throw e;
          }
        }}
      />
    </>
  );
}

