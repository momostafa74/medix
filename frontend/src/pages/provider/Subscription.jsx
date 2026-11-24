import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import CheckIcon from '@mui/icons-material/Check';
import WorkspacePremiumOutlined from '@mui/icons-material/WorkspacePremiumOutlined';
import ReceiptOutlined from '@mui/icons-material/ReceiptOutlined';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { ENTITY_LABEL, INVOICE_STATUS, goToGateway, PAY_METHOD, SUB_STATUS, daysUntil, downloadReceipt, useMySubscription, usePayments, useStatement } from '../../api/payments';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import FileUploadButton from '../../components/FileUploadButton';
import ProtectedFile from '../../components/ProtectedFile';
import RangeBar, { rangeFor } from '../../components/RangeBar';
import { TrendLine } from '../../components/Charts';
import { ErrorState, ListSkeleton, PageHeader, Section, StatCard, StatusChip } from '../../components/common';
import { CouponField, PaymentStatusChip } from '../../components/payments/PayUi';
import { fmtDate, fmtDateTime, fmtMoney, fmtShortDate } from '../../utils/format';

export { subscriptionPath, SubscriptionBanner } from '../../components/payments/SubscriptionBanner';

const METHODS = [
  { value: 'ONLINE', label: 'بطاقة / دفع إلكتروني', hint: 'تفعيل فوري' },
  { value: 'INSTAPAY', label: 'إنستاباي', hint: 'مراجعة خلال يوم عمل' },
  { value: 'VODAFONE_CASH', label: 'فودافون كاش', hint: 'مراجعة خلال يوم عمل' },
  { value: 'BANK_TRANSFER', label: 'تحويل بنكي', hint: 'مراجعة خلال يوم عمل' },
];

function transferTarget(method, cfg) {
  if (method === 'INSTAPAY') return cfg.instapay && <>حوّل على عنوان إنستاباي <b dir="ltr">{cfg.instapay}</b></>;
  if (method === 'VODAFONE_CASH') return cfg.vodafoneCash && <>حوّل على رقم فودافون كاش <b dir="ltr">{cfg.vodafoneCash}</b></>;
  if (method === 'BANK_TRANSFER') return cfg.bankAccount && <>حوّل على: <b>{cfg.bankAccount}</b></>;
  return null;
}

function RenewForm({ data, onDone }) {
  const { enqueueSnackbar } = useSnackbar();
  const { reload } = useAuth();
  const plans = data.plans;
  const [planId, setPlanId] = useState(data.subscription.plan?.id && plans.some((p) => p.id === data.subscription.plan.id) ? data.subscription.plan.id : plans.find((p) => p.isDefault)?.id || plans[0]?.id);
  const [periods, setPeriods] = useState(1);
  const [coupon, setCoupon] = useState(null);
  const [method, setMethod] = useState(data.payment.online ? 'ONLINE' : 'INSTAPAY');
  const [proof, setProof] = useState(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const plan = plans.find((p) => p.id === planId);
  const amount = plan ? plan.price * periods : 0;
  const total = Math.max(0, Math.round((amount - (coupon?.discount || 0)) * 100) / 100);
  const manual = method !== 'ONLINE';
  const methods = METHODS.filter((m) => (m.value === 'ONLINE' ? data.payment.online : true));
  const reviewing = data.invoices.find((i) => i.status === 'AWAITING_REVIEW');

  const pickPlan = (id) => {
    setPlanId(id);
    setCoupon(null);
  };
  const submit = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post('/subscriptions/me/subscribe', {
        planId,
        periods,
        method: total === 0 ? 'ONLINE' : method,
        couponCode: coupon?.code,
        proofFileId: manual && total > 0 ? proof?.id : undefined,
        transferReference: manual && total > 0 ? reference.trim() || undefined : undefined,
      });
      if (r.status === 'REDIRECT') {
        goToGateway(r.redirectUrl);
        return;
      }
      if (r.status === 'ACTIVATED') {
        enqueueSnackbar('تم تفعيل الاشتراك', { variant: 'success' });
        await reload();
      } else {
        enqueueSnackbar('تم إرسال إيصال التحويل للمراجعة — هيوصلك إشعار عند التفعيل', { variant: 'success' });
      }
      setProof(null);
      setReference('');
      setCoupon(null);
      onDone();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (reviewing) {
    return (
      <Alert severity="info">
        تحويلك (<b dir="ltr">{reviewing.code}</b> — {fmtMoney(reviewing.total)} عبر {reviewing.methodLabel}) قيد المراجعة من فريق الحسابات. سيتم تفعيل الاشتراك فور اعتماده.
      </Alert>
    );
  }
  if (!plans.length) return <Alert severity="warning">لا توجد باقات متاحة لنوع حسابك حالياً — تواصل مع الدعم.</Alert>;

  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        {plans.map((p) => {
          const sel = p.id === planId;
          return (
            <Grid key={p.id} xs={12} md={plans.length > 1 ? 6 : 12}>
              <Card variant="outlined" sx={{ borderColor: sel ? 'primary.main' : undefined, borderWidth: sel ? 2 : 1, height: '100%' }}>
                <CardActionArea onClick={() => pickPlan(p.id)} sx={{ height: '100%', p: 2 }} aria-pressed={sel}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Typography fontWeight={800}>{p.nameAr}</Typography>
                    <Radio checked={sel} size="small" tabIndex={-1} sx={{ p: 0 }} />
                  </Stack>
                  <Typography variant="h5" fontWeight={800} sx={{ my: 1 }}>
                    {fmtMoney(p.price)} <Typography component="span" color="text.secondary" variant="body2">/ {p.durationDays === 30 ? 'شهر' : `${p.durationDays} يوم`}</Typography>
                  </Typography>
                  {p.description && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{p.description}</Typography>}
                  <Stack spacing={0.5}>
                    {(p.features || []).map((f) => (
                      <Stack key={f} direction="row" spacing={1} alignItems="center">
                        <CheckIcon fontSize="small" color="success" />
                        <Typography variant="body2">{f}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Grid container spacing={2}>
        <Grid xs={12} sm={4}>
          <TextField select fullWidth size="small" label="المدة" value={periods} onChange={(e) => { setPeriods(Number(e.target.value)); setCoupon(null); }}>
            {[1, 2, 3, 6, 12].map((n) => (
              <MenuItem key={n} value={n}>
                {plan?.durationDays === 30 ? (n === 1 ? 'شهر' : n === 2 ? 'شهرين' : `${n} شهور`) : `${n} × ${plan?.durationDays} يوم`}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid xs={12} sm={8}>
          <CouponField serviceType="SUBSCRIPTION" providerId={data.provider.id} amount={amount} value={coupon} onChange={setCoupon} />
        </Grid>
      </Grid>

      {total > 0 && (
        <Box>
          <Typography fontWeight={700} sx={{ mb: 1 }}>طريقة الدفع</Typography>
          <RadioGroup value={method} onChange={(e) => setMethod(e.target.value)}>
            <Grid container spacing={1}>
              {methods.map((m) => (
                <Grid key={m.value} xs={12} sm={6}>
                  <Card variant="outlined" sx={{ px: 1.5, py: 0.5, borderColor: method === m.value ? 'primary.main' : undefined }}>
                    <FormControlLabel value={m.value} control={<Radio size="small" />} sx={{ width: '100%', m: 0 }} label={<Box><Typography variant="body2" fontWeight={600}>{m.label}</Typography><Typography variant="caption" color="text.secondary">{m.hint}</Typography></Box>} />
                  </Card>
                </Grid>
              ))}
            </Grid>
          </RadioGroup>
          {manual && (
            <Card variant="outlined" sx={{ mt: 2, p: 2, bgcolor: 'action.hover' }}>
              <Stack spacing={1.5}>
                <Typography variant="body2">
                  1) {transferTarget(method, data.payment) || 'بيانات التحويل غير مضبوطة — تواصل مع الدعم'} بمبلغ <b>{fmtMoney(total)}</b>.
                </Typography>
                <Typography variant="body2">2) ارفع صورة إيصال التحويل واكتب رقم العملية — يراجعها فريق الحسابات ويُفعّل اشتراكك.</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                  <FileUploadButton purpose="PAYMENT_PROOF" label={proof ? 'تغيير الإيصال' : 'رفع صورة الإيصال'} onUploaded={setProof} accept="image/jpeg,image/png,image/webp,application/pdf" />
                  {proof && <Chip color="success" size="small" label={proof.originalName || 'تم رفع الإيصال'} onDelete={() => setProof(null)} />}
                  <TextField size="small" label="رقم العملية / المرجع" value={reference} onChange={(e) => setReference(e.target.value)} inputProps={{ dir: 'ltr', maxLength: 80 }} sx={{ flex: 1 }} />
                </Stack>
              </Stack>
            </Card>
          )}
        </Box>
      )}

      <Divider />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
        <Box>
          {coupon && <Typography variant="body2" color="text.secondary">قبل الخصم {fmtMoney(amount)} • خصم {fmtMoney(coupon.discount)}</Typography>}
          <Typography variant="h5" fontWeight={800}>الإجمالي: {fmtMoney(total)}</Typography>
        </Box>
        <Button size="large" variant="contained" onClick={submit} disabled={busy || !plan || (manual && total > 0 && !proof)} startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}>
          {total === 0 ? 'تفعيل الاشتراك' : manual ? 'إرسال للمراجعة' : `ادفع ${fmtMoney(total)}`}
        </Button>
      </Stack>
    </Stack>
  );
}

export function SubscriptionPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useMySubscription();
  const { enqueueSnackbar } = useSnackbar();
  if (isLoading) return <ListSkeleton rows={4} height={90} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const s = data.subscription;
  const days = daysUntil(s.endsAt);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['subscription'] });
  };
  return (
    <>
      <PageHeader title="الاشتراك" subtitle={`اشتراك ${data.provider.nameAr} في المنصة — الحساب يظهر للمرضى ويستقبل الحجوزات طالما الاشتراك ساري.`} />
      {s.blocked && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <b>انتهى الاشتراك.</b> تم إيقاف لوحة التحكم وإخفاء الحساب من نتائج البحث حتى يتم التجديد. بياناتك ومواعيدك محفوظة كما هي.
          {!data.canPay && ' تواصل مع مدير الحساب لتجديد الاشتراك.'}
        </Alert>
      )}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid xs={12} md={4}>
          <Card sx={{ p: 2.25, height: '100%' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <WorkspacePremiumOutlined color="primary" />
              <Typography color="text.secondary">الحالة</Typography>
            </Stack>
            <StatusChip value={s.status} map={SUB_STATUS} size="medium" />
            <Typography variant="body2" sx={{ mt: 1.5 }}>{s.plan ? s.plan.nameAr : s.status === 'TRIAL' ? 'فترة تجريبية مجانية' : '—'}</Typography>
          </Card>
        </Grid>
        <Grid xs={6} md={4}>
          <StatCard label={s.status === 'TRIAL' ? 'تنتهي التجربة' : days > 0 ? 'ينتهي الاشتراك' : 'انتهى في'} value={fmtShortDate(s.endsAt)} hint={days > 0 ? `متبقي ${days} يوم` : s.status === 'GRACE' ? `فترة السماح حتى ${fmtShortDate(s.graceEndsAt)}` : undefined} tone={days > 0 && days <= 5 ? 'accent' : 'default'} />
        </Grid>
        <Grid xs={6} md={4}>
          <StatCard label="آخر دفعة" value={s.lastPaidAt ? fmtShortDate(s.lastPaidAt) : '—'} hint={s.plan ? `${fmtMoney(s.plan.price)} / ${s.plan.durationDays} يوم` : undefined} />
        </Grid>
      </Grid>

      {data.canPay ? (
        <Section title={s.status === 'TRIAL' ? 'اشترك الآن' : 'تجديد الاشتراك'} sx={{ mb: 2 }}>
          <RenewForm data={data} onDone={refresh} />
        </Section>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>تجديد الاشتراك متاح لمدير الحساب فقط — تواصل معه لو الاشتراك قرب ينتهي.</Alert>
      )}

      <Section title="فواتير الاشتراك">
        <DataTable
          dense
          rows={data.invoices}
          columns={[
            { key: 'code', label: 'الفاتورة', nowrap: true, render: (r) => <span dir="ltr">{r.code}</span> },
            { key: 'planName', label: 'الباقة', render: (r) => `${r.planName}${r.periods > 1 ? ` × ${r.periods}` : ''}` },
            { key: 'total', label: 'المبلغ', nowrap: true, render: (r) => <>{fmtMoney(r.total)}{r.discount > 0 && <Typography variant="caption" color="success.main" display="block">خصم {fmtMoney(r.discount)}{r.couponCode ? ` (${r.couponCode})` : ''}</Typography>}</> },
            { key: 'method', label: 'الطريقة', render: (r) => r.methodLabel },
            { key: 'period', label: 'الفترة', render: (r) => (r.periodStart ? `${fmtShortDate(r.periodStart)} ← ${fmtShortDate(r.periodEnd)}` : '—') },
            { key: 'status', label: 'الحالة', render: (r) => <Stack spacing={0.5} alignItems="flex-start"><StatusChip value={r.status} map={INVOICE_STATUS} />{r.reviewNote && <Typography variant="caption" color="text.secondary">{r.reviewNote}</Typography>}</Stack> },
            {
              key: 'act',
              label: '',
              render: (r) => (
                <Stack direction="row">
                  {r.proofFileId && <ProtectedFile fileId={r.proofFileId} label="الإيصال" />}
                  {r.status === 'PAID' && r.paymentId && (
                    <Button size="small" startIcon={<ReceiptOutlined />} onClick={() => downloadReceipt({ id: r.paymentId, code: r.code }).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>
                      إيصال
                    </Button>
                  )}
                </Stack>
              ),
            },
          ]}
          empty={<Typography color="text.secondary" sx={{ p: 2 }}>لا توجد فواتير بعد.</Typography>}
        />
      </Section>
    </>
  );
}

/** Provider earnings: what patients paid, the platform commission and the running balance. */
export function EarningsPage() {
  const [range, setRange] = useState(rangeFor(30));
  const [page, setPage] = useState(1);
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = useStatement(range);
  const list = usePayments('provider', { ...range, page, pageSize: 15 });
  const rule = data?.commissionRule;
  const bal = data?.balance?.balance ?? 0;
  const daily = useMemo(() => data?.daily || [], [data]);
  return (
    <>
      <PageHeader title="الإيرادات والمستحقات" subtitle="ما دفعه المرضى، عمولة المنصة، والرصيد بينك وبين المنصة." actions={<RangeBar value={range} onChange={(r) => { setRange(r); setPage(1); }} />} />
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid xs={6} md={3}><StatCard loading={isLoading} label="إجمالي المدفوعات" value={fmtMoney(data?.totals.gross)} hint={data ? `${data.totals.payments} عملية` : ''} /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} label="عمولة المنصة" value={fmtMoney(data?.totals.commission)} hint={rule ? `حالياً ${rule.type === 'PERCENTAGE' ? `${rule.value}%` : `${fmtMoney(rule.value)} للعملية`}` : ''} /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} tone="primary" label="صافي إيرادك" value={fmtMoney(data?.totals.net)} hint={data ? `أونلاين ${fmtMoney(data.totals.online)} • في المكان ${fmtMoney(data.totals.desk)}` : ''} /></Grid>
        <Grid xs={6} md={3}>
          <StatCard loading={isLoading} tone="accent" label={bal >= 0 ? 'مستحق لك من المنصة' : 'مستحق للمنصة عليك'} value={fmtMoney(Math.abs(bal))} hint="الرصيد الكلي حتى الآن" />
        </Grid>
      </Grid>
      <Alert severity="info" sx={{ mb: 2 }}>
        المدفوعات الأونلاين تحصّلها المنصة وتحوّل لك صافيها، أما المدفوعات النقدية في مكانك فتُخصم عمولتها من رصيدك. يتم التسوية دورياً من فريق الحسابات.
      </Alert>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid xs={12} md={8}>
          <Section title="صافي الإيراد اليومي"><TrendLine data={daily} dataKey="net" name="الصافي" money /></Section>
        </Grid>
        <Grid xs={12} md={4}>
          <Section title="التسويات">
            {data?.settlements?.length ? (
              <Stack spacing={1}>
                {data.settlements.map((s) => (
                  <Box key={s.id} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                    <Typography variant="body2" fontWeight={700}>{s.direction === 'TO_PROVIDER' ? 'حوّلت المنصة لك' : 'سددت للمنصة'} {fmtMoney(s.amount)}</Typography>
                    <Typography variant="caption" color="text.secondary">{fmtDate(s.created_at)}{s.reference ? ` • ${s.reference}` : ''}</Typography>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary" variant="body2">لا توجد تسويات في هذه الفترة.</Typography>
            )}
          </Section>
        </Grid>
      </Grid>
      <Section title="المدفوعات">
        <DataTable
          dense
          loading={list.isLoading}
          rows={list.data?.items || []}
          total={list.data?.total || 0}
          page={page}
          pageSize={15}
          onPageChange={setPage}
          columns={[
            { key: 'code', label: 'العملية', nowrap: true, render: (r) => <span dir="ltr">{r.code}</span> },
            { key: 'createdAt', label: 'التاريخ', nowrap: true, render: (r) => fmtDateTime(r.paidAt || r.createdAt) },
            { key: 'payerName', label: 'المريض' },
            { key: 'entityType', label: 'الخدمة', render: (r) => ENTITY_LABEL[r.entityType] },
            { key: 'method', label: 'الطريقة', render: (r) => <>{PAY_METHOD[r.method]}<Typography variant="caption" color="text.secondary" display="block">{r.collectedBy === 'PLATFORM' ? 'حصّلتها المنصة' : 'حصّلتها أنت'}</Typography></> },
            { key: 'amount', label: 'المبلغ', nowrap: true, render: (r) => <>{fmtMoney(r.amount)}{r.refundedAmount > 0 && <Typography variant="caption" color="error" display="block">مسترد {fmtMoney(r.refundedAmount)}</Typography>}</> },
            { key: 'commission', label: 'العمولة', nowrap: true, render: (r) => (r.commission != null ? fmtMoney(r.commission) : '—') },
            { key: 'providerAmount', label: 'صافيك', nowrap: true, render: (r) => (r.providerAmount != null ? <b>{fmtMoney(r.providerAmount)}</b> : '—') },
            { key: 'status', label: 'الحالة', render: (r) => <PaymentStatusChip value={r.status} /> },
            { key: 'r', label: '', render: (r) => <Button size="small" onClick={() => downloadReceipt(r).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>إيصال</Button> },
          ]}
          empty={<Typography color="text.secondary" sx={{ p: 2 }}>لا توجد مدفوعات في هذه الفترة.</Typography>}
        />
      </Section>
    </>
  );
}
