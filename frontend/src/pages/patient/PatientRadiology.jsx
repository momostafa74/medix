import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Card, Chip, Pagination, Stack, Tab, Tabs, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import ArrowForward from '@mui/icons-material/ArrowForward';
import MonitorHeartOutlined from '@mui/icons-material/MonitorHeartOutlined';
import OpenInNew from '@mui/icons-material/OpenInNewOutlined';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { downloadRadReport, useRadOrder, useRadOrders } from '../../api/radiology';
import { PAYMENT_METHOD } from '../../api/labs';
import { useRealtime } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Section } from '../../components/common';
import { HistoryList } from '../../components/lab/LabUi';
import ReasonDialog from '../../components/lab/ReasonDialog';
import { ImageGallery, RadStatusChip, RadTrack, ReportView } from '../../components/radiology/RadUi';
import ProtectedFile from '../../components/ProtectedFile';
import ChatButton from '../../components/ChatButton';
import { fmtDate, fmtDateTime, fmtMoney, fmtTime } from '../../utils/format';
import { whatsappLink } from '../../utils/whatsapp';
import { RAD_STATUS } from '../../api/radiology';
import { tokens } from '../../theme';
import { DiscountLine, PaymentPanel } from '../../components/payments/PayUi';

const TABS = { open: 'BOOKED,CHECKED_IN,EXAMINATION,REPORTING', ready: 'APPROVED,DELIVERED', closed: 'CANCELLED,NO_SHOW' };

export function PatientRadiology() {
  const [tab, setTab] = useState('open');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  useRealtime('radiology:order', () => qc.invalidateQueries({ queryKey: ['radiology-orders'] }));
  const { data, isLoading, error, refetch } = useRadOrders('patient', { status: TABS[tab], page, pageSize: 10 });
  return (
    <>
      <PageHeader title="الأشعة" subtitle="حجوزات الأشعة وتقاريرها — يصلك التقرير هنا فور اعتماده." actions={<Button variant="contained" component={RouterLink} to="/radiology-services">احجز أشعة</Button>} />
      <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(1); }} sx={{ mb: 2 }}>
        <Tab value="open" label="جارية" />
        <Tab value="ready" label="التقارير" />
        <Tab value="closed" label="ملغاة" />
      </Tabs>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? <ListSkeleton rows={3} height={110} /> : data?.items.length ? (
        <Stack spacing={1.5}>
          {data.items.map((o) => (
            <Card key={o.id} component={RouterLink} to={`/patient/radiology/${o.id}`} sx={{ p: 2, textDecoration: 'none', color: 'inherit', '&:hover': { borderColor: tokens.petrol } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>{o.serviceName}</Typography>
                  <Typography variant="body2" color="text.secondary">{o.center.nameAr} • {o.branchName}</Typography>
                  <Typography variant="body2">{fmtDate(o.scheduledAt)} — {fmtTime(o.scheduledAt)}</Typography>
                </Box>
                <Stack alignItems={{ sm: 'flex-end' }} spacing={0.5}>
                  <RadStatusChip value={o.status} />
                  <Typography sx={{ fontWeight: 600 }}>{fmtMoney(o.price)}</Typography>
                </Stack>
              </Stack>
              {tab === 'open' && <RadTrack status={o.status} />}
            </Card>
          ))}
        </Stack>
      ) : (
        <EmptyState icon={<MonitorHeartOutlined />} title={tab === 'ready' ? 'لا توجد تقارير بعد' : tab === 'closed' ? 'لا توجد حجوزات ملغاة' : 'لا توجد حجوزات أشعة جارية'} body="قارن أسعار الأشعة في المراكز المعتمدة واحجز موعدك." action={<Button variant="outlined" component={RouterLink} to="/radiology-services">ابحث عن فحص</Button>} />
      )}
      {data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 2 }}><Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} /></Stack>}
    </>
  );
}

export function PatientRadiologyDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data: o, isLoading, error, refetch } = useRadOrder(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useRealtime('radiology:order', (e) => e.id === id && qc.invalidateQueries({ queryKey: ['radiology-orders', id] }));
  // Opening an approved report counts as delivery.
  useEffect(() => {
    if (o?.status === 'APPROVED' && o.viewer === 'PATIENT') api.post(`/radiology-orders/${id}/report/viewed`).then(() => qc.invalidateQueries({ queryKey: ['radiology-orders'] })).catch(() => {});
  }, [o?.status, o?.viewer, id, qc]);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={3} height={140} />;
  const wa = whatsappLink(o.center.whatsappNumber, { doctorName: o.center.nameAr });
  const download = async () => {
    setBusy(true);
    try {
      await downloadRadReport(o);
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button component={RouterLink} to="/patient/radiology" startIcon={<ArrowForward />} sx={{ mb: 1 }}>كل الأشعة</Button>
      <PageHeader
        title={o.service.name}
        subtitle={`${o.center.nameAr} • ${o.code}`}
        actions={[
          o.can.downloadReport && <Button key="pdf" variant="contained" startIcon={<PictureAsPdfOutlined />} onClick={download} disabled={busy}>{busy ? 'جاري التحميل…' : 'تحميل التقرير PDF'}</Button>,
          o.pacsUrl && <Button key="pacs" variant="outlined" startIcon={<OpenInNew />} href={o.pacsUrl} target="_blank" rel="noopener noreferrer">عرض الصور (PACS)</Button>,
          o.can.chat && <ChatButton key="chat" payload={{ type: 'PATIENT_PROVIDER', providerId: o.center.providerId }} label="مراسلة المركز" variant="outlined" />,
          wa && <Button key="wa" variant="outlined" color="success" href={wa} target="_blank" rel="noopener noreferrer">واتساب</Button>,
          o.can.cancel && <Button key="c" color="error" onClick={() => setCancelOpen(true)}>إلغاء الحجز</Button>,
        ].filter(Boolean)}
      />
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <RadStatusChip value={o.status} size="medium" />
          {o.cancelReason && <Typography color="text.secondary">السبب: {o.cancelReason}</Typography>}
        </Stack>
        <RadTrack status={o.status} />
      </Card>
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          {o.report ? (
            <Section title="التقرير" action={o.report.approvedAt && <Typography variant="body2" color="text.secondary">اعتمد {fmtDateTime(o.report.approvedAt)}</Typography>}>
              <ReportView report={o.report} indication={o.clinicalIndication} />
              {!!o.images.length && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>صور مرفقة</Typography>
                  <ImageGallery images={o.images} />
                </Box>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>التقرير يُفسَّر بمعرفة طبيبك المعالج، ويظهر تلقائياً في سجلك الطبي للطبيب الذي تحجز عنده.</Typography>
            </Section>
          ) : (
            <Section title="تعليمات الفحص">
              {o.status === 'BOOKED' && o.service.preparationInstructions ? (
                <Alert severity="warning">قبل الفحص: {o.service.preparationInstructions}</Alert>
              ) : (
                <Typography color="text.secondary">{o.status === 'BOOKED' ? 'لا توجد تعليمات خاصة. احضر قبل الموعد بـ 15 دقيقة ومعك أي أشعة سابقة.' : o.status === 'REPORTING' ? 'الفحص تم، والتقرير قيد الكتابة. سيصلك إشعار فور اعتماده.' : RAD_STATUS[o.status]?.label}</Typography>
              )}
            </Section>
          )}
        </Grid>
        <Grid xs={12} md={4}>
          <Stack spacing={2}>
            <Section title="تفاصيل الحجز">
              <Typography sx={{ fontWeight: 600 }}>{o.branch?.name}</Typography>
              <Typography variant="body2" color="text.secondary">{o.branch?.address}</Typography>
              <Typography sx={{ mt: 1 }}>{fmtDate(o.scheduledAt)} — {fmtTime(o.scheduledAt)}</Typography>
              <Typography variant="body2" color="text.secondary">مدة الفحص {o.service.durationMinutes} دقيقة</Typography>
              <Box sx={{ borderTop: `1px solid ${tokens.line}`, mt: 1, pt: 1 }}>
                {Number(o.discount) > 0 && <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">السعر</Typography><Typography>{fmtMoney(o.price)}</Typography></Stack>}
                <DiscountLine discount={Number(o.discount)} />
                <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>المطلوب</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoney(o.total ?? o.price)}</Typography></Stack>
                <Typography variant="body2" color={o.paymentStatus === 'PAID' ? 'success.main' : 'text.secondary'}>{o.paymentStatus === 'PAID' ? `مدفوع (${PAYMENT_METHOD[o.paymentMethod] || ''})` : o.paymentStatus === 'REFUNDED' ? 'تم استرداد المبلغ' : 'غير مدفوع بعد'}</Typography>
              </Box>
              {o.referralFileId && <Box sx={{ mt: 1 }}><ProtectedFile fileId={o.referralFileId} label="خطاب التحويل" /></Box>}
              {o.clinicalIndication && !o.report && <Typography variant="body2" sx={{ mt: 1 }}>سبب الفحص: {o.clinicalIndication}</Typography>}
            </Section>
            <PaymentPanel entityType="RADIOLOGY_ORDER" entityId={o.id} note="الدفع في المركز يوم الفحص." />
            <Section title="سجل الحجز"><HistoryList history={o.history} labels={RAD_STATUS} /></Section>
          </Stack>
        </Grid>
      </Grid>
      <ReasonDialog open={cancelOpen} title="إلغاء حجز الأشعة" body="سيتم إلغاء الحجز وإتاحة الموعد لغيرك." label="السبب (اختياري)" confirmText="إلغاء الحجز" danger onClose={() => setCancelOpen(false)}
        onSubmit={async (reason) => {
          try {
            await api.post(`/radiology-orders/${id}/cancel`, { reason: reason || undefined });
            enqueueSnackbar('تم إلغاء الحجز', { variant: 'success' });
            qc.invalidateQueries({ queryKey: ['radiology-orders'] });
          } catch (e) {
            enqueueSnackbar(errorMessage(e), { variant: 'error' });
            throw e;
          }
        }}
      />
      {o.status === 'NO_SHOW' && <Chip label="لم يتم الحضور في الموعد" color="error" sx={{ mt: 2 }} />}
    </>
  );
}
