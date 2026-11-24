import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { ENTITY_LABEL, INVOICE_STATUS, PAYMENT_STATUS, PAY_METHOD, SERVICE_TYPE, SUB_STATUS, daysUntil, downloadReceipt, usePayment, usePayments } from '../../api/payments';
import { useAuth } from '../../auth/AuthProvider';
import DataTable from '../../components/DataTable';
import ProtectedFile from '../../components/ProtectedFile';
import RangeBar, { rangeFor } from '../../components/RangeBar';
import { RankBars, StackedBars } from '../../components/Charts';
import { ErrorState, ListSkeleton, PageHeader, Section, StatCard, StatusChip, useDebounced } from '../../components/common';
import { PaymentStatusChip } from '../../components/payments/PayUi';
import { fmtDateTime, fmtMoney, fmtShortDate } from '../../utils/format';
import { PROVIDER_TYPE } from '../../utils/labels';

const get = (url) => api.get(url).then((r) => r.data);
const ptype = (t) => PROVIDER_TYPE[t]?.label || PROVIDER_TYPE[t] || t;
const useSnack = () => {
  const { enqueueSnackbar } = useSnackbar();
  return { ok: (m) => enqueueSnackbar(m, { variant: 'success' }), fail: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }) };
};

/** Provider search (uses the balances endpoint so finance staff can use it too). */
function ProviderPicker({ value, onChange, label = 'مقدم الخدمة', type }) {
  const [text, setText] = useState('');
  const search = useDebounced(text);
  const { data, isFetching } = useQuery({ queryKey: ['finance', 'providers', search, type], queryFn: () => get(`/finance/balances${qs({ search, type, pageSize: 20 })}`) });
  const options = data?.items || [];
  return (
    <Autocomplete
      size="small"
      options={options}
      value={value}
      loading={isFetching}
      onChange={(_, v) => onChange(v)}
      onInputChange={(_, v) => setText(v)}
      getOptionLabel={(o) => o?.nameAr || ''}
      isOptionEqualToValue={(a, b) => a.providerId === b.providerId}
      filterOptions={(x) => x}
      renderOption={(props, o) => (
        <li {...props} key={o.providerId}>
          <Stack><span>{o.nameAr}</span><Typography variant="caption" color="text.secondary">{ptype(o.type)}</Typography></Stack>
        </li>
      )}
      renderInput={(p) => <TextField {...p} label={label} />}
    />
  );
}

// ───────────────────────── Dashboard ─────────────────────────

export function AdminFinanceDashboard() {
  const [range, setRange] = useState(rangeFor(30));
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'dashboard', range], queryFn: () => get(`/finance/dashboard${qs(range)}`) });
  const t = data?.totals;
  return (
    <>
      <PageHeader title="المالية" subtitle="المدفوعات وعمولة المنصة والاشتراكات ومستحقات مقدمي الخدمة." actions={<RangeBar value={range} onChange={setRange} />} />
      {error && <ErrorState error={error} onRetry={refetch} />}
      {data?.subscriptions.awaitingReview > 0 && (
        <Alert severity="info" sx={{ mb: 2 }} action={<Button color="inherit" size="small" component={RouterLink} to="/admin/subscriptions?tab=review">مراجعة</Button>}>
          {data.subscriptions.awaitingReview} تحويل اشتراك بانتظار المراجعة.
        </Alert>
      )}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid xs={6} md={3}><StatCard loading={isLoading} tone="primary" label="إيراد المنصة" value={fmtMoney(t?.platformRevenue)} hint="عمولات + اشتراكات" /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} label="عمولات الخدمات" value={fmtMoney(t?.commission)} hint={t ? `من ${fmtMoney(t.servicesGross)} مدفوعات` : ''} /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} label="الاشتراكات" value={fmtMoney(t?.subscriptions)} hint={data ? `الدخل الشهري المتكرر ${fmtMoney(data.subscriptions.mrr)}` : ''} /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} tone="accent" label="مستحق لمقدمي الخدمة" value={fmtMoney(data?.balances.owedToProviders)} hint={data ? `عليهم للمنصة ${fmtMoney(data.balances.owedByProviders)}` : ''} /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} label="مدفوع أونلاين" value={fmtMoney(t?.onlineGross)} /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} label="مدفوع في المكان" value={fmtMoney(t?.deskGross)} /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} label="المستردات" value={fmtMoney(t?.refunds)} hint={t ? `${t.refundsCount} عملية` : ''} /></Grid>
        <Grid xs={6} md={3}><StatCard loading={isLoading} label="محاولات دفع فاشلة" value={t?.failedPayments ?? '—'} /></Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid xs={12} md={8}>
          <Section title="إيراد المنصة اليومي">
            <StackedBars money data={data?.daily} keys={[{ key: 'commission', label: 'عمولات' }, { key: 'subscriptions', label: 'اشتراكات' }]} />
          </Section>
        </Grid>
        <Grid xs={12} md={4}>
          <Section title="الاشتراكات">
            {data ? (
              <Stack spacing={1}>
                {[
                  ['ACTIVE', data.subscriptions.active],
                  ['TRIAL', data.subscriptions.trial],
                  ['GRACE', data.subscriptions.grace],
                  ['EXPIRED', data.subscriptions.expired],
                ].map(([k, v]) => (
                  <Stack key={k} direction="row" justifyContent="space-between" alignItems="center">
                    <StatusChip value={k} map={SUB_STATUS} />
                    <Typography fontWeight={700}>{v}</Typography>
                  </Stack>
                ))}
                <Typography variant="body2" color="text.secondary">تنتهي خلال 5 أيام: {data.subscriptions.expiring_soon}</Typography>
                <Button component={RouterLink} to="/admin/subscriptions" size="small">إدارة الاشتراكات</Button>
              </Stack>
            ) : <ListSkeleton rows={4} height={28} />}
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="المدفوعات حسب نوع مقدم الخدمة">
            <RankBars data={(data?.byType || []).map((r) => ({ name: `${ptype(r.type)} (${r.count} عملية)`, gross: Math.round(r.gross) }))} labelKey="name" valueKey="gross" unit=" ج.م" />
          </Section>
        </Grid>
        <Grid xs={12} md={6}>
          <Section title="أعلى مقدمي الخدمة (عمولة)">
            <RankBars data={(data?.topProviders || []).slice(0, 8).map((r) => ({ name: r.name_ar, commission: Math.round(r.commission) }))} labelKey="name" valueKey="commission" unit=" ج.م" />
          </Section>
        </Grid>
      </Grid>
    </>
  );
}

// ───────────────────────── Payments ─────────────────────────

function RefundDialog({ payment, onClose, onDone }) {
  const max = payment ? Math.round((payment.amount - payment.refundedAmount) * 100) / 100 : 0;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const s = useSnack();
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/payments/${payment.id}/refund`, { amount: amount ? Number(amount) : undefined, reason: reason.trim() });
      s.ok('تم تسجيل الاسترداد');
      onDone();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!payment} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>استرداد مبلغ</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            {payment?.collectedBy === 'PLATFORM' ? 'سيتم الرد على وسيلة الدفع الأصلية عبر بوابة الدفع.' : 'المبلغ دُفع لمقدم الخدمة مباشرة — يُسجَّل الاسترداد في الدفاتر وتُعكس العمولة.'} الحد الأقصى {fmtMoney(max)}.
          </Alert>
          <TextField label="المبلغ (فارغ = استرداد كامل)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ min: 0.01, max, step: 0.01 }} />
          <TextField label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} inputProps={{ maxLength: 300 }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>إلغاء</Button>
        <Button color="error" variant="contained" onClick={submit} disabled={busy || reason.trim().length < 3 || (amount && (Number(amount) <= 0 || Number(amount) > max))}>استرداد</Button>
      </DialogActions>
    </Dialog>
  );
}

function PaymentDrawer({ id, onClose }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const s = useSnack();
  const { data: p, isLoading, error } = usePayment(id);
  const [refund, setRefund] = useState(false);
  return (
    <Drawer anchor="left" open={!!id} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 2 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" dir="ltr">{p?.code}</Typography>
        <IconButton onClick={onClose} aria-label="إغلاق"><CloseIcon /></IconButton>
      </Stack>
      {error && <ErrorState error={error} />}
      {isLoading ? <ListSkeleton rows={4} /> : p && (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1}><PaymentStatusChip value={p.status} /><Chip size="small" variant="outlined" label={p.collectedBy === 'PLATFORM' ? 'حصّلتها المنصة' : 'حصّلها مقدم الخدمة'} /></Stack>
          <Typography><b>الخدمة:</b> {p.description}{p.entityCode ? ` — ${p.entityCode}` : ''}</Typography>
          <Typography><b>مقدم الخدمة:</b> {p.provider?.nameAr}</Typography>
          <Typography><b>الطريقة:</b> {p.methodLabel}{p.gateway ? ` (${p.gateway})` : ''}</Typography>
          <Typography><b>المبلغ:</b> {fmtMoney(p.amount)}</Typography>
          {p.refundedAmount > 0 && <Typography color="error"><b>المسترد:</b> {fmtMoney(p.refundedAmount)}</Typography>}
          <Typography><b>التاريخ:</b> {fmtDateTime(p.paidAt || p.createdAt)}</Typography>
          {p.failureReason && <Alert severity="error">{p.failureReason}</Alert>}
          {p.commission && (
            <Section title="توزيع المبلغ">
              <Typography variant="body2">العمولة: {fmtMoney(p.commission.commission - p.commission.reversed_commission)}{p.commission.reversed_commission > 0 ? ` (عُكس ${fmtMoney(p.commission.reversed_commission)})` : ''}</Typography>
              <Typography variant="body2">صافي مقدم الخدمة: {fmtMoney(p.commission.provider - p.commission.reversed_provider)}</Typography>
            </Section>
          )}
          {p.refunds.length > 0 && (
            <Section title="الاستردادات">
              {p.refunds.map((r, i) => (
                <Typography key={i} variant="body2">{fmtMoney(r.amount)} — {r.reason} • {fmtShortDate(r.created_at)}</Typography>
              ))}
            </Section>
          )}
          <Stack direction="row" spacing={1}>
            {['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status) && <Button variant="outlined" onClick={() => downloadReceipt(p).catch(s.fail)}>الإيصال</Button>}
            {can('payments.refund') && ['PAID', 'PARTIALLY_REFUNDED'].includes(p.status) && p.entityType !== 'SUBSCRIPTION' && (
              <Button color="error" variant="outlined" onClick={() => setRefund(true)}>استرداد</Button>
            )}
          </Stack>
        </Stack>
      )}
      <RefundDialog
        payment={refund ? p : null}
        onClose={() => setRefund(false)}
        onDone={() => {
          setRefund(false);
          qc.invalidateQueries({ queryKey: ['payments'] });
        }}
      />
    </Drawer>
  );
}

export function AdminPayments() {
  const [f, setF] = useState({ status: '', method: '', entityType: '', collectedBy: '' });
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const search = useDebounced(text);
  const { data, isLoading, error, refetch } = usePayments('admin', { ...f, search, page, pageSize: 20 });
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const sel = (k, label, opts) => (
    <TextField select size="small" label={label} value={f[k]} onChange={set(k)} sx={{ minWidth: 150 }}>
      <MenuItem value="">الكل</MenuItem>
      {Object.entries(opts).map(([v, l]) => <MenuItem key={v} value={v}>{l.label || l}</MenuItem>)}
    </TextField>
  );
  return (
    <>
      <PageHeader title="المدفوعات" subtitle="كل عمليات الدفع على المنصة مع العمولة والاسترداد." />
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
          <TextField size="small" placeholder="رقم العملية، مقدم الخدمة، الدافع…" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} sx={{ minWidth: 260 }} />
          {sel('status', 'الحالة', PAYMENT_STATUS)}
          {sel('method', 'الطريقة', { CASH: PAY_METHOD.CASH, CARD: PAY_METHOD.CARD, ONLINE: PAY_METHOD.ONLINE, WALLET: PAY_METHOD.WALLET })}
          {sel('entityType', 'الخدمة', ENTITY_LABEL)}
          {sel('collectedBy', 'التحصيل', { PLATFORM: 'المنصة', PROVIDER: 'مقدم الخدمة' })}
        </Stack>
      </Card>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items || []}
          total={data?.total || 0}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          onRowClick={(r) => setOpen(r.id)}
          columns={[
            { key: 'code', label: 'العملية', nowrap: true, render: (r) => <span dir="ltr">{r.code}</span> },
            { key: 'createdAt', label: 'التاريخ', nowrap: true, render: (r) => fmtDateTime(r.paidAt || r.createdAt) },
            { key: 'providerName', label: 'مقدم الخدمة', render: (r) => <Stack><span>{r.providerName}</span><Typography variant="caption" color="text.secondary">{ENTITY_LABEL[r.entityType]}</Typography></Stack> },
            { key: 'payerName', label: 'الدافع' },
            { key: 'method', label: 'الطريقة', render: (r) => PAY_METHOD[r.method] },
            { key: 'amount', label: 'المبلغ', nowrap: true, render: (r) => <>{fmtMoney(r.amount)}{r.refundedAmount > 0 && <Typography variant="caption" color="error" display="block">مسترد {fmtMoney(r.refundedAmount)}</Typography>}</> },
            { key: 'commission', label: 'العمولة', nowrap: true, render: (r) => (r.commission != null ? fmtMoney(r.commission) : r.entityType === 'SUBSCRIPTION' ? 'اشتراك' : '—') },
            { key: 'status', label: 'الحالة', render: (r) => <PaymentStatusChip value={r.status} /> },
          ]}
        />
      </Card>
      <PaymentDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

// ───────────────────────── Subscriptions ─────────────────────────

function ReviewDialog({ invoice, action, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const s = useSnack();
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/subscriptions/invoices/${invoice.id}/${action}`, { note: note.trim() || undefined });
      s.ok(action === 'approve' ? 'تم اعتماد التحويل وتفعيل الاشتراك' : 'تم رفض التحويل');
      setNote('');
      onDone();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!invoice} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{action === 'approve' ? 'اعتماد التحويل' : 'رفض التحويل'}</DialogTitle>
      <DialogContent>
        {invoice && (
          <Typography sx={{ mb: 2 }}>
            {invoice.provider.nameAr} — {fmtMoney(invoice.total)} عبر {invoice.methodLabel}
            {invoice.transferReference ? <> (مرجع <span dir="ltr">{invoice.transferReference}</span>)</> : ''}
          </Typography>
        )}
        <TextField fullWidth multiline minRows={2} label={action === 'approve' ? 'ملاحظة (اختياري)' : 'سبب الرفض (يظهر لمقدم الخدمة)'} value={note} onChange={(e) => setNote(e.target.value)} inputProps={{ maxLength: 300 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" color={action === 'approve' ? 'primary' : 'error'} onClick={submit} disabled={busy || (action === 'reject' && note.trim().length < 3)}>
          {action === 'approve' ? 'اعتماد' : 'رفض'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function InvoicesTable({ status }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [review, setReview] = useState(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['subscription', 'invoices', status, page], queryFn: () => get(`/admin/subscriptions/invoices${qs({ status, page, pageSize: 20 })}`) });
  return (
    <>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <DataTable
        loading={isLoading}
        rows={data?.items || []}
        total={data?.total || 0}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        columns={[
          { key: 'code', label: 'الفاتورة', nowrap: true, render: (r) => <Stack><span dir="ltr">{r.code}</span><Typography variant="caption" color="text.secondary">{fmtDateTime(r.createdAt)}</Typography></Stack> },
          { key: 'provider', label: 'مقدم الخدمة', render: (r) => <Stack><span>{r.provider.nameAr}</span><Typography variant="caption" color="text.secondary">{ptype(r.provider.type)}</Typography></Stack> },
          { key: 'planName', label: 'الباقة', render: (r) => `${r.planName}${r.periods > 1 ? ` × ${r.periods}` : ''}` },
          { key: 'total', label: 'المبلغ', nowrap: true, render: (r) => <>{fmtMoney(r.total)}{r.discount > 0 && <Typography variant="caption" color="success.main" display="block">خصم {fmtMoney(r.discount)} {r.couponCode}</Typography>}</> },
          { key: 'method', label: 'الطريقة', render: (r) => <Stack><span>{r.methodLabel}</span>{r.transferReference && <Typography variant="caption" dir="ltr">{r.transferReference}</Typography>}</Stack> },
          { key: 'status', label: 'الحالة', render: (r) => <StatusChip value={r.status} map={INVOICE_STATUS} /> },
          {
            key: 'act',
            label: '',
            render: (r) => (
              <Stack direction="row" spacing={0.5} alignItems="center">
                {r.proofFileId && <ProtectedFile fileId={r.proofFileId} label="الإيصال" />}
                {r.status === 'AWAITING_REVIEW' && (
                  <>
                    <Button size="small" variant="contained" onClick={() => setReview({ invoice: r, action: 'approve' })}>اعتماد</Button>
                    <Button size="small" color="error" onClick={() => setReview({ invoice: r, action: 'reject' })}>رفض</Button>
                  </>
                )}
              </Stack>
            ),
          },
        ]}
        empty={<Typography color="text.secondary" sx={{ p: 3 }}>{status === 'AWAITING_REVIEW' ? 'لا توجد تحويلات بانتظار المراجعة 🎉' : 'لا توجد فواتير'}</Typography>}
      />
      <ReviewDialog
        invoice={review?.invoice}
        action={review?.action}
        onClose={() => setReview(null)}
        onDone={() => {
          setReview(null);
          qc.invalidateQueries({ queryKey: ['subscription'] });
          qc.invalidateQueries({ queryKey: ['finance'] });
        }}
      />
    </>
  );
}

function ManualPaymentDialog({ row, onClose, onDone }) {
  const { data: plans } = useQuery({ queryKey: ['subscription', 'plans', 'admin'], queryFn: () => get('/admin/subscriptions/plans'), enabled: !!row });
  const [form, setForm] = useState({ planId: '', periods: 1, method: 'CASH', reference: '', note: '' });
  const [extend, setExtend] = useState({ days: 7, note: '' });
  const [mode, setMode] = useState('pay');
  const [busy, setBusy] = useState(false);
  const s = useSnack();
  const options = (plans || []).filter((p) => row && p.providerType === row.type && p.isActive);
  const planId = form.planId || options.find((p) => p.isDefault)?.id || options[0]?.id || '';
  const plan = options.find((p) => p.id === planId);
  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'pay') {
        await api.post(`/admin/subscriptions/providers/${row.providerId}/payments`, { ...form, planId, periods: Number(form.periods), reference: form.reference || undefined, note: form.note || undefined });
        s.ok('تم تسجيل الدفعة وتجديد الاشتراك');
      } else {
        await api.post(`/admin/subscriptions/providers/${row.providerId}/extend`, { days: Number(extend.days), note: extend.note });
        s.ok('تم تمديد الاشتراك');
      }
      onDone();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{row?.nameAr}</DialogTitle>
      <DialogContent>
        <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ mb: 2 }}>
          <Tab value="pay" label="تسجيل دفعة" />
          <Tab value="extend" label="تمديد مجاني" />
        </Tabs>
        {mode === 'pay' ? (
          <Stack spacing={2}>
            <TextField select label="الباقة" value={planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
              {options.map((p) => <MenuItem key={p.id} value={p.id}>{p.nameAr} — {fmtMoney(p.price)}</MenuItem>)}
            </TextField>
            <TextField select label="المدة" value={form.periods} onChange={(e) => setForm({ ...form, periods: e.target.value })}>
              {[1, 2, 3, 6, 12].map((n) => <MenuItem key={n} value={n}>{n} × {plan?.durationDays || 30} يوم</MenuItem>)}
            </TextField>
            <TextField select label="طريقة الدفع" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {['CASH', 'INSTAPAY', 'VODAFONE_CASH', 'BANK_TRANSFER'].map((m) => <MenuItem key={m} value={m}>{PAY_METHOD[m]}</MenuItem>)}
            </TextField>
            <TextField label="المرجع" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} inputProps={{ dir: 'ltr', maxLength: 80 }} />
            <TextField label="ملاحظة" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} inputProps={{ maxLength: 300 }} />
            {plan && <Typography fontWeight={700}>الإجمالي: {fmtMoney(plan.price * form.periods)}</Typography>}
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Alert severity="info">يمدّ نهاية الاشتراك بدون فاتورة (تعويض عن عطل، عرض خاص…). يُسجّل في سجل المراجعة.</Alert>
            <TextField type="number" label="عدد الأيام" value={extend.days} onChange={(e) => setExtend({ ...extend, days: e.target.value })} inputProps={{ min: 1, max: 365 }} />
            <TextField label="السبب" value={extend.note} onChange={(e) => setExtend({ ...extend, note: e.target.value })} inputProps={{ maxLength: 300 }} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={submit} disabled={busy || (mode === 'pay' ? !planId : extend.note.trim().length < 3 || !(Number(extend.days) >= 1))}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

function SubscribersTable() {
  const qc = useQueryClient();
  const [f, setF] = useState({ status: '', type: '', expiringDays: '' });
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [row, setRow] = useState(null);
  const search = useDebounced(text);
  const params = { ...f, search, page, pageSize: 20 };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['subscription', 'list', params], queryFn: () => get(`/admin/subscriptions${qs(params)}`), placeholderData: (p) => p });
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }} useFlexGap flexWrap="wrap">
        <TextField size="small" placeholder="اسم مقدم الخدمة أو الهاتف" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
        <TextField select size="small" label="الحالة" value={f.status} onChange={set('status')} sx={{ minWidth: 150 }}>
          <MenuItem value="">الكل</MenuItem>
          {Object.entries(SUB_STATUS).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="النوع" value={f.type} onChange={set('type')} sx={{ minWidth: 150 }}>
          <MenuItem value="">الكل</MenuItem>
          {['DOCTOR', 'LABORATORY', 'RADIOLOGY', 'PHARMACY'].map((k) => <MenuItem key={k} value={k}>{ptype(k)}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="ينتهي خلال" value={f.expiringDays} onChange={set('expiringDays')} sx={{ minWidth: 150 }}>
          <MenuItem value="">أي وقت</MenuItem>
          {[3, 7, 14, 30].map((d) => <MenuItem key={d} value={d}>{d} يوم</MenuItem>)}
        </TextField>
      </Stack>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <DataTable
        loading={isLoading}
        rows={(data?.items || []).map((r) => ({ ...r, id: r.providerId }))}
        total={data?.total || 0}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        columns={[
          { key: 'nameAr', label: 'مقدم الخدمة', render: (r) => <Stack><span>{r.nameAr}</span><Typography variant="caption" color="text.secondary">{ptype(r.type)} • {r.ownerName} <span dir="ltr">{r.ownerPhone}</span></Typography></Stack> },
          { key: 'status', label: 'الحالة', render: (r) => <StatusChip value={r.status} map={SUB_STATUS} /> },
          { key: 'planName', label: 'الباقة', render: (r) => r.planName || '—' },
          { key: 'endsAt', label: 'ينتهي', nowrap: true, render: (r) => { const d = daysUntil(r.endsAt); return <Stack><span>{fmtShortDate(r.endsAt)}</span><Typography variant="caption" color={d <= 3 ? 'error' : 'text.secondary'}>{d > 0 ? `باقي ${d} يوم` : `منذ ${-d} يوم`}</Typography></Stack>; } },
          { key: 'paidTotal', label: 'إجمالي المدفوع', nowrap: true, render: (r) => fmtMoney(r.paidTotal) },
          { key: 'act', label: '', render: (r) => <Button size="small" onClick={() => setRow(r)}>تجديد / تمديد</Button> },
        ]}
      />
      <ManualPaymentDialog
        row={row}
        onClose={() => setRow(null)}
        onDone={() => {
          setRow(null);
          qc.invalidateQueries({ queryKey: ['subscription'] });
        }}
      />
    </>
  );
}

const EMPTY_PLAN = { code: '', providerType: 'DOCTOR', nameAr: '', description: '', price: '', durationDays: 30, features: '', isDefault: false, isActive: true, sortOrder: 0 };

function PlansTable() {
  const qc = useQueryClient();
  const s = useSnack();
  const { data, isLoading } = useQuery({ queryKey: ['subscription', 'plans', 'admin'], queryFn: () => get('/admin/subscriptions/plans') });
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const body = { ...edit, price: Number(edit.price), durationDays: Number(edit.durationDays), sortOrder: Number(edit.sortOrder) || 0, features: edit.features.split('\n').map((x) => x.trim()).filter(Boolean), description: edit.description || undefined };
    delete body.id;
    try {
      if (edit.id) await api.patch(`/admin/subscriptions/plans/${edit.id}`, body);
      else await api.post('/admin/subscriptions/plans', body);
      s.ok('تم حفظ الباقة');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['subscription'] });
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const field = (k) => ({ value: edit?.[k] ?? '', onChange: (e) => setEdit({ ...edit, [k]: e.target.value }) });
  return (
    <>
      <Stack direction="row" justifyContent="flex-end" sx={{ p: 2 }}>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setEdit({ ...EMPTY_PLAN })}>باقة جديدة</Button>
      </Stack>
      <DataTable
        loading={isLoading}
        rows={data || []}
        columns={[
          { key: 'nameAr', label: 'الباقة', render: (r) => <Stack><span>{r.nameAr}{r.isDefault && <Chip size="small" label="افتراضية" sx={{ mx: 1 }} />}</span><Typography variant="caption" dir="ltr" color="text.secondary">{r.code}</Typography></Stack> },
          { key: 'providerType', label: 'لـ', render: (r) => ptype(r.providerType) },
          { key: 'price', label: 'السعر', render: (r) => `${fmtMoney(r.price)} / ${r.durationDays} يوم` },
          { key: 'subscribers', label: 'المشتركون' },
          { key: 'isActive', label: 'الحالة', render: (r) => <Chip size="small" color={r.isActive ? 'success' : 'default'} label={r.isActive ? 'متاحة' : 'موقوفة'} /> },
          { key: 'e', label: '', render: (r) => <IconButton size="small" aria-label="تعديل" onClick={() => setEdit({ ...r, description: r.description || '', features: (r.features || []).join('\n') })}><EditOutlined fontSize="small" /></IconButton> },
        ]}
      />
      <Dialog open={!!edit} onClose={() => setEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{edit?.id ? 'تعديل باقة' : 'باقة جديدة'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid xs={12} sm={6}><TextField fullWidth label="الكود" {...field('code')} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} inputProps={{ dir: 'ltr' }} helperText="مثال DOCTOR_YEARLY" /></Grid>
            <Grid xs={12} sm={6}>
              <TextField fullWidth select label="نوع مقدم الخدمة" {...field('providerType')}>
                {['DOCTOR', 'LABORATORY', 'RADIOLOGY', 'PHARMACY', 'HOSPITAL', 'HOME_CARE'].map((k) => <MenuItem key={k} value={k}>{ptype(k)}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid xs={12}><TextField fullWidth label="الاسم" {...field('nameAr')} /></Grid>
            <Grid xs={6} sm={4}><TextField fullWidth type="number" label="السعر (ج.م)" {...field('price')} /></Grid>
            <Grid xs={6} sm={4}><TextField fullWidth type="number" label="المدة (يوم)" {...field('durationDays')} /></Grid>
            <Grid xs={12} sm={4}><TextField fullWidth type="number" label="الترتيب" {...field('sortOrder')} /></Grid>
            <Grid xs={12}><TextField fullWidth label="الوصف" {...field('description')} /></Grid>
            <Grid xs={12}><TextField fullWidth multiline minRows={3} label="المزايا (ميزة في كل سطر)" {...field('features')} /></Grid>
            <Grid xs={12}>
              <FormControlLabel control={<Switch checked={!!edit?.isDefault} onChange={(e) => setEdit({ ...edit, isDefault: e.target.checked })} />} label="الباقة الافتراضية لهذا النوع" />
              <FormControlLabel control={<Switch checked={!!edit?.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />} label="متاحة للاشتراك" />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>إلغاء</Button>
          <Button variant="contained" onClick={save} disabled={busy || !edit?.code || !edit?.nameAr || edit?.price === ''}>حفظ</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function AdminSubscriptions() {
  const initial = new URLSearchParams(window.location.search).get('tab') || 'subscribers';
  const [tab, setTab] = useState(initial);
  const qc = useQueryClient();
  const s = useSnack();
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    try {
      await api.post('/admin/subscriptions/sync');
      s.ok('تم تحديث حالات الاشتراكات');
      qc.invalidateQueries({ queryKey: ['subscription'] });
    } catch (e) {
      s.fail(e);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <>
      <PageHeader
        title="اشتراكات مقدمي الخدمة"
        subtitle="الأطباء والمعامل ومراكز الأشعة والصيدليات يدفعون اشتراكاً دورياً — الحساب المنتهي يُخفى ويُقفل حتى التجديد. المرضى مجاناً."
        actions={<Button variant="outlined" onClick={sync} disabled={syncing}>{syncing ? <CircularProgress size={18} /> : 'تحديث الحالات الآن'}</Button>}
      />
      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
          <Tab value="subscribers" label="المشتركون" />
          <Tab value="review" label="مراجعة التحويلات" />
          <Tab value="invoices" label="كل الفواتير" />
          <Tab value="plans" label="الباقات" />
        </Tabs>
        <Box>
          {tab === 'subscribers' && <SubscribersTable />}
          {tab === 'review' && <InvoicesTable status="AWAITING_REVIEW" />}
          {tab === 'invoices' && <InvoicesTable status="" />}
          {tab === 'plans' && <PlansTable />}
        </Box>
      </Card>
    </>
  );
}

// ───────────────────────── Coupons ─────────────────────────

const EMPTY_COUPON = { code: '', description: '', type: 'PERCENTAGE', value: '', maxDiscount: '', minOrder: '', usageLimit: '', perUserLimit: '', serviceType: '', provider: null, startsAt: '', expiresAt: '', isActive: true };
const num = (v) => (v === '' || v == null ? null : Number(v));

export function AdminCoupons() {
  const qc = useQueryClient();
  const s = useSnack();
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = useDebounced(text);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'coupons', search, page], queryFn: () => get(`/finance/coupons${qs({ search, page, pageSize: 20 })}`), placeholderData: (p) => p });
  const save = async () => {
    setBusy(true);
    const body = {
      code: edit.code,
      description: edit.description || undefined,
      type: edit.type,
      value: Number(edit.value),
      maxDiscount: num(edit.maxDiscount),
      minOrder: num(edit.minOrder),
      usageLimit: num(edit.usageLimit),
      perUserLimit: num(edit.perUserLimit),
      serviceType: edit.serviceType || null,
      providerId: edit.provider?.providerId || null,
      startsAt: edit.startsAt ? new Date(edit.startsAt).toISOString() : null,
      expiresAt: edit.expiresAt ? new Date(`${edit.expiresAt}T23:59:59`).toISOString() : null,
      isActive: edit.isActive,
    };
    try {
      if (edit.id) await api.patch(`/finance/coupons/${edit.id}`, body);
      else await api.post('/finance/coupons', body);
      s.ok('تم حفظ الكوبون');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['finance', 'coupons'] });
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const field = (k) => ({ value: edit?.[k] ?? '', onChange: (e) => setEdit({ ...edit, [k]: e.target.value }) });
  const toDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  return (
    <>
      <PageHeader title="أكواد الخصم" subtitle="خصومات على الكشوفات والتحاليل والأشعة والصيدلية واشتراكات مقدمي الخدمة." actions={<Button startIcon={<AddIcon />} variant="contained" onClick={() => setEdit({ ...EMPTY_COUPON })}>كود جديد</Button>} />
      <Card sx={{ p: 2, mb: 2 }}>
        <TextField size="small" placeholder="ابحث بالكود أو الوصف" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
      </Card>
      {error && <ErrorState error={error} onRetry={refetch} />}
      <Card>
        <DataTable
          loading={isLoading}
          rows={data?.items || []}
          total={data?.total || 0}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          columns={[
            { key: 'code', label: 'الكود', nowrap: true, render: (r) => <Stack><b dir="ltr">{r.code}</b><Typography variant="caption" color="text.secondary">{r.description}</Typography></Stack> },
            { key: 'value', label: 'الخصم', render: (r) => (r.type === 'PERCENTAGE' ? `${r.value}%${r.maxDiscount ? ` (حد ${fmtMoney(r.maxDiscount)})` : ''}` : fmtMoney(r.value)) },
            { key: 'serviceType', label: 'على', render: (r) => <Stack><span>{SERVICE_TYPE[r.serviceType] || 'كل الخدمات'}</span>{r.providerName && <Typography variant="caption" color="text.secondary">{r.providerName}</Typography>}</Stack> },
            { key: 'usedCount', label: 'الاستخدام', render: (r) => `${r.usedCount}${r.usageLimit ? ` / ${r.usageLimit}` : ''}` },
            { key: 'totalDiscount', label: 'إجمالي الخصم', nowrap: true, render: (r) => fmtMoney(r.totalDiscount) },
            { key: 'expiresAt', label: 'ينتهي', nowrap: true, render: (r) => (r.expiresAt ? fmtShortDate(r.expiresAt) : '—') },
            { key: 'isActive', label: 'الحالة', render: (r) => <Chip size="small" color={r.isActive ? 'success' : 'default'} label={r.isActive ? 'فعال' : 'موقوف'} /> },
            {
              key: 'e',
              label: '',
              render: (r) => (
                <IconButton size="small" aria-label="تعديل" onClick={() => setEdit({ ...EMPTY_COUPON, ...r, description: r.description || '', maxDiscount: r.maxDiscount ?? '', minOrder: r.minOrder ?? '', usageLimit: r.usageLimit ?? '', perUserLimit: r.perUserLimit ?? '', serviceType: r.serviceType || '', provider: r.providerId ? { providerId: r.providerId, nameAr: r.providerName } : null, startsAt: toDate(r.startsAt), expiresAt: toDate(r.expiresAt) })}>
                  <EditOutlined fontSize="small" />
                </IconButton>
              ),
            },
          ]}
        />
      </Card>
      <Dialog open={!!edit} onClose={() => setEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{edit?.id ? 'تعديل كود' : 'كود خصم جديد'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid xs={12} sm={6}><TextField fullWidth label="الكود" {...field('code')} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} inputProps={{ dir: 'ltr', maxLength: 30 }} /></Grid>
            <Grid xs={12} sm={6}><TextField fullWidth label="الوصف" {...field('description')} /></Grid>
            <Grid xs={6} sm={4}>
              <TextField fullWidth select label="النوع" {...field('type')}>
                <MenuItem value="PERCENTAGE">نسبة %</MenuItem>
                <MenuItem value="FIXED">مبلغ ثابت</MenuItem>
              </TextField>
            </Grid>
            <Grid xs={6} sm={4}><TextField fullWidth type="number" label={edit?.type === 'PERCENTAGE' ? 'النسبة %' : 'المبلغ'} {...field('value')} /></Grid>
            <Grid xs={6} sm={4}><TextField fullWidth type="number" label="أقصى خصم" {...field('maxDiscount')} disabled={edit?.type !== 'PERCENTAGE'} /></Grid>
            <Grid xs={6} sm={4}><TextField fullWidth type="number" label="حد أدنى للطلب" {...field('minOrder')} /></Grid>
            <Grid xs={6} sm={4}><TextField fullWidth type="number" label="عدد الاستخدامات الكلي" {...field('usageLimit')} /></Grid>
            <Grid xs={6} sm={4}><TextField fullWidth type="number" label="لكل مستخدم" {...field('perUserLimit')} /></Grid>
            <Grid xs={12} sm={6}>
              <TextField fullWidth select label="الخدمة" {...field('serviceType')}>
                <MenuItem value="">كل الخدمات (ما عدا الاشتراكات)</MenuItem>
                {Object.entries(SERVICE_TYPE).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid xs={12} sm={6}><ProviderPicker label="مقدم خدمة محدد (اختياري)" value={edit?.provider || null} onChange={(v) => setEdit({ ...edit, provider: v })} /></Grid>
            <Grid xs={6}><TextField fullWidth type="date" label="يبدأ" InputLabelProps={{ shrink: true }} {...field('startsAt')} /></Grid>
            <Grid xs={6}><TextField fullWidth type="date" label="ينتهي" InputLabelProps={{ shrink: true }} {...field('expiresAt')} /></Grid>
            <Grid xs={12}><FormControlLabel control={<Switch checked={!!edit?.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />} label="فعال" /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>إلغاء</Button>
          <Button variant="contained" onClick={save} disabled={busy || !edit?.code || !(Number(edit?.value) > 0)}>حفظ</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ───────────────────────── Commission & settlements ─────────────────────────

const SCOPE = { GLOBAL: 'افتراضي للمنصة', PROVIDER_TYPE: 'حسب نوع مقدم الخدمة', PROVIDER: 'مقدم خدمة محدد' };

function RulesSection() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const s = useSnack();
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'rules'], queryFn: () => get('/finance/commission-rules') });
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const body = { scope: edit.scope, providerType: edit.scope === 'PROVIDER_TYPE' ? edit.providerType : null, providerId: edit.scope === 'PROVIDER' ? edit.provider?.providerId : null, type: edit.type, value: Number(edit.value), isActive: edit.isActive };
    try {
      if (edit.id) await api.patch(`/finance/commission-rules/${edit.id}`, body);
      else await api.post('/finance/commission-rules', body);
      s.ok('تم حفظ القاعدة — تُطبق على المدفوعات الجديدة فقط');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const manage = can('commission.manage');
  return (
    <Section title="قواعد العمولة" action={manage && <Button size="small" startIcon={<AddIcon />} onClick={() => setEdit({ scope: 'PROVIDER_TYPE', providerType: 'DOCTOR', provider: null, type: 'PERCENTAGE', value: '', isActive: true })}>قاعدة جديدة</Button>}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>الأكثر تحديداً يكسب: مقدم خدمة محدد ← نوع مقدم الخدمة ← الافتراضي. العمولة تُحسب وقت الدفع وتُحفظ مع العملية.</Typography>
      <DataTable
        dense
        loading={isLoading}
        rows={data || []}
        columns={[
          { key: 'scope', label: 'النطاق', render: (r) => SCOPE[r.scope] },
          { key: 'target', label: 'على', render: (r) => r.provider_name || (r.provider_type ? ptype(r.provider_type) : 'الكل') },
          { key: 'value', label: 'العمولة', render: (r) => (r.type === 'PERCENTAGE' ? `${Number(r.value)}%` : `${fmtMoney(r.value)} للعملية`) },
          { key: 'is_active', label: 'الحالة', render: (r) => <Chip size="small" color={r.is_active ? 'success' : 'default'} label={r.is_active ? 'فعالة' : 'موقوفة'} /> },
          { key: 'e', label: '', render: (r) => manage && <IconButton size="small" aria-label="تعديل" onClick={() => setEdit({ id: r.id, scope: r.scope, providerType: r.provider_type || 'DOCTOR', provider: r.provider_id ? { providerId: r.provider_id, nameAr: r.provider_name } : null, type: r.type, value: Number(r.value), isActive: r.is_active })}><EditOutlined fontSize="small" /></IconButton> },
        ]}
      />
      <Dialog open={!!edit} onClose={() => setEdit(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{edit?.id ? 'تعديل قاعدة' : 'قاعدة عمولة جديدة'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label="النطاق" value={edit?.scope || ''} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} disabled={!!edit?.id}>
              {Object.entries(SCOPE).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
            {edit?.scope === 'PROVIDER_TYPE' && (
              <TextField select label="النوع" value={edit.providerType} onChange={(e) => setEdit({ ...edit, providerType: e.target.value })} disabled={!!edit?.id}>
                {['DOCTOR', 'LABORATORY', 'RADIOLOGY', 'PHARMACY'].map((k) => <MenuItem key={k} value={k}>{ptype(k)}</MenuItem>)}
              </TextField>
            )}
            {edit?.scope === 'PROVIDER' && <ProviderPicker value={edit.provider} onChange={(v) => setEdit({ ...edit, provider: v })} />}
            <Stack direction="row" spacing={2}>
              <TextField select label="النوع" value={edit?.type || 'PERCENTAGE'} onChange={(e) => setEdit({ ...edit, type: e.target.value })} sx={{ flex: 1 }}>
                <MenuItem value="PERCENTAGE">نسبة %</MenuItem>
                <MenuItem value="FIXED">مبلغ ثابت</MenuItem>
              </TextField>
              <TextField type="number" label="القيمة" value={edit?.value ?? ''} onChange={(e) => setEdit({ ...edit, value: e.target.value })} sx={{ flex: 1 }} />
            </Stack>
            <FormControlLabel control={<Switch checked={!!edit?.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />} label="فعالة" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>إلغاء</Button>
          <Button variant="contained" onClick={save} disabled={busy || edit?.value === '' || (edit?.scope === 'PROVIDER' && !edit?.provider)}>حفظ</Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

function SettleDialog({ row, onClose, onDone }) {
  const [form, setForm] = useState({ amount: '', method: 'تحويل بنكي', reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const s = useSnack();
  const direction = row && row.balance < 0 ? 'TO_PLATFORM' : 'TO_PROVIDER';
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/finance/settlements', { providerId: row.providerId, direction, amount: Number(form.amount || Math.abs(row.balance)), method: form.method || undefined, reference: form.reference || undefined, note: form.note || undefined });
      s.ok('تم تسجيل التسوية');
      setForm({ amount: '', method: 'تحويل بنكي', reference: '', note: '' });
      onDone();
    } catch (e) {
      s.fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>تسوية — {row?.nameAr}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity={direction === 'TO_PROVIDER' ? 'info' : 'warning'}>
            {direction === 'TO_PROVIDER' ? `المنصة تحوّل لمقدم الخدمة مستحقاته (${fmtMoney(row?.balance)}).` : `مقدم الخدمة يسدد للمنصة عمولة النقدي (${fmtMoney(Math.abs(row?.balance || 0))}).`}
          </Alert>
          <TextField type="number" label="المبلغ" placeholder={row ? String(Math.abs(row.balance)) : ''} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} InputLabelProps={{ shrink: true }} />
          <TextField label="الطريقة" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} />
          <TextField label="المرجع" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} inputProps={{ dir: 'ltr' }} />
          <TextField label="ملاحظة" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !(Number(form.amount || Math.abs(row?.balance || 0)) > 0)}>تسجيل</Button>
      </DialogActions>
    </Dialog>
  );
}

export function AdminCommissions() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [nonZero, setNonZero] = useState(true);
  const [page, setPage] = useState(1);
  const [settle, setSettle] = useState(null);
  const balances = useQuery({ queryKey: ['finance', 'balances', type, nonZero, page], queryFn: () => get(`/finance/balances${qs({ type, nonZero, page, pageSize: 20 })}`), placeholderData: (p) => p });
  const settlements = useQuery({ queryKey: ['finance', 'settlements'], queryFn: () => get('/finance/settlements') });
  return (
    <>
      <PageHeader title="العمولات والمستحقات" subtitle="قواعد العمولة، رصيد كل مقدم خدمة، وتسجيل التحويلات." />
      <Stack spacing={2}>
        <RulesSection />
        <Section
          title="أرصدة مقدمي الخدمة"
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField select size="small" label="النوع" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} sx={{ minWidth: 140 }}>
                <MenuItem value="">الكل</MenuItem>
                {['DOCTOR', 'LABORATORY', 'RADIOLOGY', 'PHARMACY'].map((k) => <MenuItem key={k} value={k}>{ptype(k)}</MenuItem>)}
              </TextField>
              <FormControlLabel control={<Switch size="small" checked={nonZero} onChange={(e) => setNonZero(e.target.checked)} />} label="بحركة فقط" />
            </Stack>
          }
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>الرصيد = صافي الأونلاين − عمولة النقدي − ما حُوّل لمقدم الخدمة + ما سدده. موجب: المنصة مدينة له. سالب: عليه للمنصة.</Typography>
          <DataTable
            dense
            loading={balances.isLoading}
            rows={(balances.data?.items || []).map((r) => ({ ...r, id: r.providerId }))}
            total={balances.data?.total || 0}
            page={page}
            pageSize={20}
            onPageChange={setPage}
            columns={[
              { key: 'nameAr', label: 'مقدم الخدمة', render: (r) => <Stack><span>{r.nameAr}</span><Typography variant="caption" color="text.secondary">{ptype(r.type)}</Typography></Stack> },
              { key: 'onlineNet', label: 'صافي الأونلاين', nowrap: true, render: (r) => fmtMoney(r.onlineNet) },
              { key: 'cashCommission', label: 'عمولة النقدي', nowrap: true, render: (r) => fmtMoney(r.cashCommission) },
              { key: 'paid', label: 'تسويات', render: (r) => `${fmtMoney(r.paidToProvider)} / ${fmtMoney(r.paidToPlatform)}` },
              { key: 'balance', label: 'الرصيد', nowrap: true, render: (r) => <Typography fontWeight={700} color={r.balance > 0 ? 'primary' : r.balance < 0 ? 'error' : 'text.secondary'}>{fmtMoney(r.balance)}</Typography> },
              { key: 'a', label: '', render: (r) => can('settlements.manage') && Math.abs(r.balance) >= 0.01 && <Button size="small" onClick={() => setSettle(r)}>تسوية</Button> },
            ]}
          />
        </Section>
        <Section title="سجل التسويات">
          <DataTable
            dense
            loading={settlements.isLoading}
            rows={settlements.data || []}
            columns={[
              { key: 'created_at', label: 'التاريخ', nowrap: true, render: (r) => fmtDateTime(r.created_at) },
              { key: 'provider_name', label: 'مقدم الخدمة' },
              { key: 'direction', label: 'الاتجاه', render: (r) => (r.direction === 'TO_PROVIDER' ? 'المنصة ← مقدم الخدمة' : 'مقدم الخدمة ← المنصة') },
              { key: 'amount', label: 'المبلغ', nowrap: true, render: (r) => fmtMoney(r.amount) },
              { key: 'method', label: 'الطريقة', render: (r) => <Stack><span>{r.method || '—'}</span>{r.reference && <Typography variant="caption" dir="ltr">{r.reference}</Typography>}</Stack> },
              { key: 'by_name', label: 'بواسطة' },
            ]}
          />
        </Section>
      </Stack>
      <SettleDialog
        row={settle}
        onClose={() => setSettle(null)}
        onDone={() => {
          setSettle(null);
          qc.invalidateQueries({ queryKey: ['finance'] });
        }}
      />
    </>
  );
}
