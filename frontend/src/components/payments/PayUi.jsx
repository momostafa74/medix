import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, IconButton, Stack, TextField, Typography } from '@mui/material';
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined';
import ReceiptOutlined from '@mui/icons-material/ReceiptOutlined';
import { useSnackbar } from 'notistack';
import { errorMessage } from '../../api/client';
import { PAYMENT_STATUS, downloadReceipt, previewCoupon, startCheckout, usePaymentsConfig, useRecordPayment } from '../../api/payments';
import { StatusChip } from '../common';
import { fmtDateTime, fmtMoney } from '../../utils/format';

export const PaymentStatusChip = ({ value }) => <StatusChip value={value} map={PAYMENT_STATUS} />;

/**
 * Coupon input with server preview. `value` is the applied coupon ({ code, discount, total })
 * or null; the booking request sends `value.code` as couponCode — the server recomputes it.
 */
export function CouponField({ serviceType, providerId, amount, value, onChange, disabled }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const apply = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setErr('');
    try {
      onChange(await previewCoupon({ code: code.trim(), serviceType, providerId, amount: Number(amount) || 0 }));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (value) {
    return (
      <Alert
        severity="success"
        icon={<LocalOfferOutlined />}
        action={
          <IconButton size="small" aria-label="إزالة الكود" onClick={() => { onChange(null); setCode(''); }} disabled={disabled}>
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      >
        كود <b dir="ltr">{value.code}</b> — خصم {fmtMoney(value.discount)}
        {value.description ? ` (${value.description})` : ''}
      </Alert>
    );
  }
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          size="small"
          label="كود خصم (اختياري)"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
          inputProps={{ dir: 'ltr', maxLength: 30, 'aria-label': 'كود الخصم' }}
          error={!!err}
          helperText={err || ' '}
          disabled={disabled}
          sx={{ flex: 1 }}
        />
        <Button variant="outlined" onClick={apply} disabled={busy || !code.trim() || disabled} sx={{ minWidth: 88, height: 40 }}>
          {busy ? <CircularProgress size={18} /> : 'تطبيق'}
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * Payment box on a patient's booking/order page: status, pay-online button,
 * attempts and receipts.
 */
export function PaymentPanel({ entityType, entityId, title = 'الدفع', note }) {
  const { data, isLoading } = useRecordPayment(entityType, entityId);
  const [busy, setBusy] = useState(false);
  const { enqueueSnackbar } = useSnackbar();
  if (isLoading || !data) return null;
  const paid = data.payments.filter((p) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status));
  const lastFailed = data.payments[0]?.status === 'FAILED' ? data.payments[0] : null;
  const pay = async () => {
    setBusy(true);
    try {
      await startCheckout(entityType, entityId);
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      setBusy(false);
    }
  };
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
          <Chip size="small" color={data.paymentStatus === 'PAID' ? 'success' : data.paymentStatus === 'REFUNDED' ? 'default' : 'warning'} label={data.paymentStatus === 'PAID' ? 'مدفوع' : data.paymentStatus === 'REFUNDED' ? 'مسترد' : 'غير مدفوع'} />
        </Stack>
        <Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>{fmtMoney(data.amount)}</Typography>
        {lastFailed && data.paymentStatus !== 'PAID' && (
          <Alert severity="error" sx={{ mb: 1 }}>محاولة الدفع الأخيرة لم تكتمل{lastFailed.failure_reason ? `: ${lastFailed.failure_reason}` : ''}.</Alert>
        )}
        {data.canPayOnline && (
          <Button fullWidth variant="contained" startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <CreditCardOutlined />} onClick={pay} disabled={busy} sx={{ mb: 1 }}>
            ادفع أونلاين الآن
          </Button>
        )}
        {data.paymentStatus !== 'PAID' && !data.canPayOnline && (
          <Typography variant="body2" color="text.secondary">{note || 'الدفع عند مقدم الخدمة.'}</Typography>
        )}
        {paid.length > 0 && (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {paid.map((p) => (
              <Stack key={p.id} direction="row" alignItems="center" spacing={1} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>{p.methodLabel} • {fmtMoney(p.amount)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmtDateTime(p.paid_at || p.created_at)}
                    {p.refunded_amount > 0 ? ` • مسترد ${fmtMoney(p.refunded_amount)}` : ''}
                  </Typography>
                </Box>
                <PaymentStatusChip value={p.status} />
                <IconButton size="small" aria-label="تحميل الإيصال" onClick={() => downloadReceipt(p).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>
                  <ReceiptOutlined fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/** Price breakdown with optional discount. */
export function DiscountLine({ discount }) {
  if (!discount) return null;
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ color: 'success.main' }}>
      <Typography variant="body2">خصم الكوبون</Typography>
      <Typography variant="body2" fontWeight={700}>− {fmtMoney(discount)}</Typography>
    </Stack>
  );
}

/** Compact "pay online" button for list rows; hidden when online payment is switched off. */
export function PayOnlineButton({ entityType, entityId, size = 'medium', label = 'ادفع أونلاين' }) {
  const { data: cfg } = usePaymentsConfig();
  const [busy, setBusy] = useState(false);
  const { enqueueSnackbar } = useSnackbar();
  if (!cfg?.online) return null;
  return (
    <Button
      size={size}
      variant="contained"
      startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <CreditCardOutlined />}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        startCheckout(entityType, entityId).catch((e) => {
          setBusy(false);
          enqueueSnackbar(errorMessage(e), { variant: 'error' });
        });
      }}
    >
      {label}
    </Button>
  );
}
