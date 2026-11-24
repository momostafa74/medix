import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Container, Divider, Stack, TextField, Typography } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import HourglassEmpty from '@mui/icons-material/HourglassEmpty';
import ReceiptOutlined from '@mui/icons-material/ReceiptOutlined';
import { useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { ENTITY_LABEL, downloadReceipt, patientRecordLink, usePayment } from '../../api/payments';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorState } from '../../components/common';
import { fmtDateTime, fmtMoney } from '../../utils/format';

const groupCard = (v) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * Stand-in for the bank's hosted page while PAYMENT_GATEWAY=sandbox. The link is signed by the
 * API, so the amount cannot be changed from the browser.
 */
export function SandboxCheckout() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const sig = sp.get('sig') || '';
  const nav = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['sandbox', id, sig], queryFn: () => api.get(`/payments/sandbox/${id}?sig=${encodeURIComponent(sig)}`).then((r) => r.data), retry: false });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: r } = await api.post(`/payments/sandbox/${id}/complete`, { sig, card: card.replace(/\s/g, '') });
      nav(`/payment/result?payment=${r.paymentId}`, { replace: true });
    } catch (err) {
      enqueueSnackbar(errorMessage(err), { variant: 'error' });
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ py: { xs: 3, md: 6 } }}>
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <LockOutlined color="primary" />
            <Typography variant="h6" fontWeight={800}>صفحة الدفع الآمن</Typography>
          </Stack>
          <Alert severity="info" sx={{ mb: 2 }}>
            بوابة تجريبية — لا يتم خصم أي مبلغ. أي رقم بطاقة صحيح يُقبل، والبطاقة <b dir="ltr">4000 0000 0000 0002</b> تُرفض.
          </Alert>
          {error && <ErrorState error={error} />}
          {isLoading && <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress /></Box>}
          {data && data.status !== 'PENDING' && (
            <Stack spacing={2}>
              <Alert severity="warning">تمت معالجة عملية الدفع هذه بالفعل.</Alert>
              <Button variant="contained" onClick={() => nav(`/payment/result?payment=${data.id}`)}>عرض النتيجة</Button>
            </Stack>
          )}
          {data && data.status === 'PENDING' && (
            <form onSubmit={submit}>
              <Stack spacing={1} sx={{ mb: 2 }}>
                <Typography color="text.secondary">{data.description}</Typography>
                {data.provider && <Typography variant="body2" color="text.secondary">{data.provider}</Typography>}
                <Typography variant="body2" color="text.secondary" dir="ltr" textAlign="right">{data.code}</Typography>
                <Divider />
                <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                  <Typography>المبلغ المطلوب</Typography>
                  <Typography variant="h5" fontWeight={800}>{fmtMoney(data.amount)}</Typography>
                </Stack>
              </Stack>
              <Stack spacing={2}>
                <TextField label="رقم البطاقة" value={card} onChange={(e) => setCard(groupCard(e.target.value))} inputProps={{ dir: 'ltr', inputMode: 'numeric', autoComplete: 'cc-number' }} required />
                <Stack direction="row" spacing={2}>
                  <TextField label="تاريخ الانتهاء" defaultValue="12/30" inputProps={{ dir: 'ltr' }} />
                  <TextField label="CVV" defaultValue="123" inputProps={{ dir: 'ltr', maxLength: 4 }} />
                </Stack>
                <Button type="submit" size="large" variant="contained" disabled={busy || card.replace(/\s/g, '').length < 12}>
                  {busy ? <CircularProgress size={22} color="inherit" /> : `ادفع ${fmtMoney(data.amount)}`}
                </Button>
                <Button onClick={() => nav(-1)} disabled={busy}>إلغاء والرجوع</Button>
              </Stack>
            </form>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}

/** Where the payer goes back to after the gateway. */
function backLink(p, user) {
  if (p.entityType === 'SUBSCRIPTION') return { to: user?.roles?.includes('DOCTOR') ? '/doctor/subscription' : '/provider/subscription', label: 'الرجوع لصفحة الاشتراك' };
  return { to: patientRecordLink(p.entityType, p.entityId) || '/patient/payments', label: `الرجوع إلى ${ENTITY_LABEL[p.entityType] ? `طلب ${ENTITY_LABEL[p.entityType]}` : 'الطلب'}` };
}

export function PaymentResult() {
  const [sp] = useSearchParams();
  const id = sp.get('payment');
  const { user, ready, reload } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  // Gateways call our webhook in parallel with the browser redirect: poll until it settles.
  const { data: p, error, isLoading } = usePayment(ready && user ? id : null, {
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 2000 : false),
  });
  // A paid subscription unlocks the account: refresh the principal so the renewal gate disappears.
  const subPaid = p?.entityType === 'SUBSCRIPTION' && p.status === 'PAID';
  useEffect(() => {
    if (subPaid) reload().catch(() => {});
  }, [subPaid, reload]);

  if (!id) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="warning">لم نتمكن من التعرف على عملية الدفع. راجع صفحة مدفوعاتك.</Alert>
      </Container>
    );
  }
  if (ready && !user) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="info" action={<Button component={RouterLink} to={`/login?next=${encodeURIComponent(`/payment/result?payment=${id}`)}`}>دخول</Button>}>سجّل الدخول لعرض نتيجة الدفع.</Alert>
      </Container>
    );
  }
  const state = !p ? null : p.status === 'PENDING' ? 'pending' : ['PAID', 'PARTIALLY_REFUNDED'].includes(p.status) ? 'ok' : p.status === 'REFUNDED' ? 'refunded' : 'failed';
  const ui = {
    ok: { icon: <CheckCircleOutline sx={{ fontSize: 64 }} color="success" />, title: 'تم الدفع بنجاح', body: p?.entityType === 'SUBSCRIPTION' ? 'تم تفعيل اشتراكك. شكراً لك!' : 'وصل لمقدم الخدمة إشعار بالدفع.' },
    pending: { icon: <HourglassEmpty sx={{ fontSize: 64 }} color="warning" />, title: 'جاري تأكيد الدفع…', body: 'ننتظر تأكيد البنك، لا تغلق الصفحة.' },
    failed: { icon: <ErrorOutline sx={{ fontSize: 64 }} color="error" />, title: 'لم تكتمل عملية الدفع', body: p?.failureReason || 'لم يتم خصم أي مبلغ. يمكنك المحاولة مرة أخرى.' },
    refunded: { icon: <ErrorOutline sx={{ fontSize: 64 }} color="warning" />, title: 'تم استرداد المبلغ', body: 'لم يعد الطلب قابلاً للدفع (أُلغي أو دُفع بطريقة أخرى)، فتم رد المبلغ تلقائياً.' },
  }[state];
  const back = p ? backLink(p, user) : null;
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 3, md: 6 } }}>
      <Card>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          {error && <ErrorState error={error} />}
          {(isLoading || !ready) && <CircularProgress />}
          {ui && (
            <Stack spacing={1.5} alignItems="center">
              {ui.icon}
              <Typography variant="h5" fontWeight={800}>{ui.title}</Typography>
              <Typography color="text.secondary">{ui.body}</Typography>
              <Box sx={{ width: '100%', textAlign: 'right', bgcolor: 'action.hover', borderRadius: 2, p: 2, my: 1 }}>
                <Typography variant="body2"><b>العملية:</b> <span dir="ltr">{p.code}</span></Typography>
                <Typography variant="body2"><b>الوصف:</b> {p.description}</Typography>
                <Typography variant="body2"><b>المبلغ:</b> {fmtMoney(p.amount)}</Typography>
                <Typography variant="body2"><b>التاريخ:</b> {fmtDateTime(p.paidAt || p.createdAt)}</Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: '100%' }} justifyContent="center">
                {state === 'ok' && (
                  <Button variant="outlined" startIcon={<ReceiptOutlined />} onClick={() => downloadReceipt(p).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>
                    تحميل الإيصال
                  </Button>
                )}
                {back && <Button variant="contained" component={RouterLink} to={back.to}>{state === 'failed' ? 'حاول مرة أخرى' : back.label}</Button>}
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
