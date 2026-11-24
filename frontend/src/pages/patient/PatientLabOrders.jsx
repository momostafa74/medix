import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Card, Chip, Pagination, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import ArrowForward from '@mui/icons-material/ArrowForward';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { DiscountLine, PaymentPanel } from '../../components/payments/PayUi';
import { downloadLabReport, PAYMENT_METHOD, useLabOrder, useLabOrders } from '../../api/labs';
import { useRealtime } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Section } from '../../components/common';
import { CriticalBanner, HistoryList, ItemsSummary, LabStatusChip, OrderTrack, ResultsTable } from '../../components/lab/LabUi';
import ReasonDialog from '../../components/lab/ReasonDialog';
import ChatButton from '../../components/ChatButton';
import { fmtDate, fmtDateTime, fmtMoney, fmtTime } from '../../utils/format';
import { whatsappLink } from '../../utils/whatsapp';
import { tokens } from '../../theme';

const TABS = {
  open: 'NEW_ORDER,PAID,SAMPLE_COLLECTED,SAMPLE_RECEIVED,PROCESSING,RESULT_ENTERED,UNDER_REVIEW',
  ready: 'APPROVED,DELIVERED',
  cancelled: 'CANCELLED',
};

export function PatientLabOrders() {
  const [tab, setTab] = useState('open');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  useRealtime('lab:order', () => qc.invalidateQueries({ queryKey: ['lab-orders'] }));
  const { data, isLoading, error, refetch } = useLabOrders('patient', { status: TABS[tab], page, pageSize: 10 });
  return (
    <>
      <PageHeader title="تحاليلي" subtitle="حجوزات التحاليل ونتائجها — تصلك النتيجة هنا فور اعتمادها من المعمل." actions={<Button variant="contained" component={RouterLink} to="/lab-tests">احجز تحليل</Button>} />
      <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(1); }} sx={{ mb: 2 }}>
        <Tab value="open" label="جارية" />
        <Tab value="ready" label="النتائج" />
        <Tab value="cancelled" label="ملغاة" />
      </Tabs>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {isLoading ? (
        <ListSkeleton rows={3} height={110} />
      ) : data?.items.length ? (
        <Stack spacing={1.5}>
          {data.items.map((o) => (
            <Card key={o.id} component={RouterLink} to={`/patient/lab-orders/${o.id}`} sx={{ p: 2, textDecoration: 'none', color: 'inherit', '&:hover': { borderColor: tokens.petrol } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontWeight: 700 }}>{o.laboratory.nameAr}</Typography>
                    {o.homeCollection && <Chip size="small" icon={<HomeOutlined />} label="سحب منزلي" variant="outlined" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" dir="ltr" sx={{ textAlign: 'right' }}>{o.itemsLabel}</Typography>
                  <Typography variant="body2">{o.scheduledAt ? `${fmtDate(o.scheduledAt)} — ${fmtTime(o.scheduledAt)}` : ''}</Typography>
                </Box>
                <Stack alignItems={{ sm: 'flex-end' }} spacing={0.5}>
                  <LabStatusChip value={o.status} />
                  <Typography sx={{ fontWeight: 600 }}>{fmtMoney(o.total)}</Typography>
                </Stack>
              </Stack>
              {tab === 'open' && <OrderTrack status={o.status} />}
            </Card>
          ))}
        </Stack>
      ) : (
        <EmptyState
          icon={<ScienceOutlined />}
          title={tab === 'ready' ? 'لا توجد نتائج بعد' : tab === 'cancelled' ? 'لا توجد طلبات ملغاة' : 'لا توجد حجوزات تحاليل جارية'}
          body="قارن أسعار التحاليل في المعامل القريبة واحجز بالفرع أو بسحب منزلي."
          action={<Button variant="outlined" component={RouterLink} to="/lab-tests">ابحث عن تحليل</Button>}
        />
      )}
      {data?.totalPages > 1 && <Stack alignItems="center" sx={{ mt: 2 }}><Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} /></Stack>}
    </>
  );
}

export function PatientLabOrderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data: o, isLoading, error, refetch } = useLabOrder(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const results = useQuery({ queryKey: ['lab-orders', id, 'results'], queryFn: () => api.get(`/lab-orders/${id}/results`).then((r) => r.data), enabled: !!o?.can?.viewResults });
  useRealtime('lab:order', (e) => e.id === id && qc.invalidateQueries({ queryKey: ['lab-orders', id] }));
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={3} height={140} />;
  const wa = whatsappLink(o.laboratory.whatsappNumber, { doctorName: o.laboratory.nameAr });
  const rejected = o.samples?.filter((s) => s.rejectedAt) || [];
  const download = async () => {
    setDownloading(true);
    try {
      await downloadLabReport(o);
      qc.invalidateQueries({ queryKey: ['lab-orders'] });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setDownloading(false);
    }
  };
  return (
    <>
      <Button component={RouterLink} to="/patient/lab-orders" startIcon={<ArrowForward />} sx={{ mb: 1 }}>كل التحاليل</Button>
      <PageHeader
        title={`طلب ${o.code}`}
        subtitle={o.laboratory.nameAr}
        actions={[
          o.can.downloadReport && <Button key="pdf" variant="contained" startIcon={<PictureAsPdfOutlined />} onClick={download} disabled={downloading}>{downloading ? 'جاري التحميل…' : 'تحميل التقرير PDF'}</Button>,
          o.can.chat && <ChatButton key="chat" payload={{ type: 'PATIENT_PROVIDER', providerId: o.laboratory.providerId }} label="مراسلة المعمل" variant="outlined" />,
          wa && <Button key="wa" variant="outlined" color="success" href={wa} target="_blank" rel="noopener noreferrer">واتساب</Button>,
          o.can.cancel && <Button key="c" color="error" onClick={() => setCancelOpen(true)}>إلغاء الحجز</Button>,
        ].filter(Boolean)}
      />
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <LabStatusChip value={o.status} size="medium" />
          {o.status === 'CANCELLED' && o.cancelReason && <Typography color="text.secondary">السبب: {o.cancelReason}</Typography>}
        </Stack>
        <OrderTrack status={o.status} />
      </Card>
      {!!rejected.length && ['NEW_ORDER', 'PAID'].includes(o.status) && (
        <Alert severity="warning" sx={{ mb: 2 }}>المعمل طلب إعادة سحب العينة: {rejected[rejected.length - 1].rejectReason}. سيتواصل معك المعمل لتحديد الموعد.</Alert>
      )}
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          {o.can.viewResults ? (
            <Section title="النتائج" action={results.data?.approvedAt && <Typography variant="body2" color="text.secondary">اعتمدت {fmtDateTime(results.data.approvedAt)}</Typography>}>
              {results.isLoading ? <Skeleton variant="rounded" height={200} /> : results.error ? <ErrorState error={results.error} /> : (
                <Stack spacing={2}>
                  <CriticalBanner count={results.data.criticalCount} />
                  <ResultsTable groups={results.data.groups} />
                  {results.data.notes && <Alert severity="info">ملاحظات المعمل: {results.data.notes}</Alert>}
                  <Typography variant="body2" color="text.secondary">النتائج تُفسَّر بمعرفة طبيبك المعالج. يمكنك مشاركة التقرير PDF معه، أو سيظهر تلقائياً في سجلك الطبي للطبيب الذي تحجز عنده.</Typography>
                </Stack>
              )}
            </Section>
          ) : (
            <Section title="التحاليل المطلوبة">
              <ItemsSummary items={o.items} />
            </Section>
          )}
          {o.can.viewResults && (
            <Section title="التحاليل المطلوبة" sx={{ mt: 2 }}>
              <ItemsSummary items={o.items} />
            </Section>
          )}
        </Grid>
        <Grid xs={12} md={4}>
          <Stack spacing={2}>
            <Section title="تفاصيل الحجز">
              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 600 }}>{o.homeCollection ? 'سحب منزلي' : o.branch?.name}</Typography>
                <Typography variant="body2" color="text.secondary">{o.homeCollection ? o.homeAddress : o.branch?.address}</Typography>
                {o.scheduledAt && <Typography>{fmtDate(o.scheduledAt)} — {o.homeCollection ? `بين ${fmtTime(o.scheduledAt)} و ${fmtTime(new Date(+new Date(o.scheduledAt) + 3600_000))}` : fmtTime(o.scheduledAt)}</Typography>}
                <Box sx={{ borderTop: `1px solid ${tokens.line}`, pt: 1 }}>
                  {o.homeFee > 0 && <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">رسوم السحب المنزلي</Typography><Typography>{fmtMoney(o.homeFee)}</Typography></Stack>}
                  <DiscountLine discount={Number(o.discount)} />
                  <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>الإجمالي</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoney(o.total)}</Typography></Stack>
                  <Typography variant="body2" color={o.paymentStatus === 'PAID' ? 'success.main' : 'text.secondary'}>
                    {o.paymentStatus === 'PAID' ? `مدفوع (${PAYMENT_METHOD[o.paymentMethod] || ''})` : o.paymentStatus === 'REFUNDED' ? 'تم استرداد المبلغ' : 'غير مدفوع بعد'}
                  </Typography>
                </Box>
              </Stack>
            </Section>
            <PaymentPanel entityType="LAB_ORDER" entityId={o.id} note="الدفع عند سحب العينة." />
            <Section title="سجل الطلب">
              <HistoryList history={o.history} />
            </Section>
          </Stack>
        </Grid>
      </Grid>
      <ReasonDialog
        open={cancelOpen}
        title="إلغاء حجز التحاليل"
        body="سيتم إلغاء الحجز وإتاحة الموعد لغيرك."
        label="السبب (اختياري)"
        confirmText="إلغاء الحجز"
        danger
        onClose={() => setCancelOpen(false)}
        onSubmit={async (reason) => {
          try {
            await api.post(`/lab-orders/${id}/cancel`, { reason: reason || undefined });
            enqueueSnackbar('تم إلغاء الحجز', { variant: 'success' });
            qc.invalidateQueries({ queryKey: ['lab-orders'] });
          } catch (e) {
            enqueueSnackbar(errorMessage(e), { variant: 'error' });
            throw e;
          }
        }}
      />
    </>
  );
}
