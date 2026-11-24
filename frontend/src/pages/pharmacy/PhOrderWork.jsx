import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ArrowForward from '@mui/icons-material/ArrowForward';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { PAYMENT_METHOD } from '../../api/labs';
import { FULFILLMENT, PH_NEXT_LABEL, PH_STATUS, medName, useMyPharmacy, usePhOrder } from '../../api/pharmacy';
import { useRealtime } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section, useDebounced } from '../../components/common';
import { HistoryList } from '../../components/lab/LabUi';
import ReasonDialog from '../../components/lab/ReasonDialog';
import ProtectedFile from '../../components/ProtectedFile';
import ChatButton from '../../components/ChatButton';
import { OrderLines, PhStatusChip, PhTrack, RxSheet } from '../../components/pharmacy/PhUi';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import { tokens } from '../../theme';

/** Search the pharmacy's own inventory (price & stock come from here). */
function InventoryPicker({ onPick, exclude }) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const { data, isFetching } = useQuery({
    queryKey: ['pharmacy', 'inventory', 'pick', q],
    queryFn: () => api.get(`/pharmacy/me/inventory${qs({ search: q, pageSize: 15 })}`).then((r) => r.data.items),
    enabled: q.length >= 2,
  });
  return (
    <Autocomplete
      size="small"
      options={(data || []).filter((i) => !exclude.includes(i.medicine.id))}
      loading={isFetching}
      value={null}
      inputValue={text}
      onInputChange={(_, v, r) => r !== 'reset' && setText(v)}
      filterOptions={(x) => x}
      getOptionLabel={(i) => medName(i.medicine)}
      getOptionDisabled={(i) => !i.inStock}
      onChange={(_, v) => {
        if (v) {
          onPick(v);
          setText('');
        }
      }}
      noOptionsText={q.length < 2 ? 'اكتب حرفين على الأقل' : 'غير موجود في أصناف الصيدلية'}
      renderOption={(props, i) => (
        <li {...props} key={i.id}>
          <Stack direction="row" justifyContent="space-between" sx={{ width: '100%' }}>
            <Typography dir="ltr">{medName(i.medicine)}</Typography>
            <Typography variant="body2" color={i.inStock ? 'text.secondary' : 'error'}>{i.inStock ? `${fmtMoney(i.price)}${i.quantity != null ? ` • ${i.quantity}` : ''}` : 'نفد'}</Typography>
          </Stack>
        </li>
      )}
      renderInput={(p) => <TextField {...p} label="إضافة صنف من مخزونك" />}
    />
  );
}

/** Confirm the order — and price it when the patient sent only a prescription. */
function ConfirmEditor({ o, onDone, onCancel }) {
  const { enqueueSnackbar } = useSnackbar();
  const { data: me } = useMyPharmacy();
  const initial = useMemo(() => {
    if (o.items.length) return o.items.map((i) => ({ medicineId: i.medicineId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice }));
    return (o.prescription?.items || []).filter((i) => i.stock?.inStock).map((i) => ({ medicineId: i.medicineId, name: i.medicineName, quantity: i.quantity || 1, unitPrice: i.stock.price }));
  }, [o]);
  const [lines, setLines] = useState(initial);
  const [note, setNote] = useState(o.pharmacistNote || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setLines(initial), [initial]);
  const subtotal = Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100;
  const fee = o.fulfillment === 'DELIVERY' && me ? (me.freeDeliveryOver != null && subtotal >= me.freeDeliveryOver ? 0 : Number(me.deliveryFee || 0)) : 0;
  const changed = !o.items.length || lines.length !== o.items.length || lines.some((l) => !o.items.find((i) => i.medicineId === l.medicineId && i.quantity === l.quantity));
  const set = (id, q) => setLines(q <= 0 ? lines.filter((l) => l.medicineId !== id) : lines.map((l) => (l.medicineId === id ? { ...l, quantity: Math.min(50, q) } : l)));
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/pharmacy-orders/${o.id}/confirm`, { items: changed ? lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity })) : undefined, pharmacistNote: note || undefined });
      enqueueSnackbar(o.items.length ? 'تم تأكيد الطلب وحجز الكميات من المخزون' : 'تم تسعير الروشتة وإرسال الإجمالي للمريض', { variant: 'success' });
      onDone();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={o.items.length ? 'تأكيد الطلب' : 'تسعير الروشتة'} sx={{ borderColor: tokens.petrol, borderWidth: 2 }}>
      <Stack spacing={1.5}>
        {!o.items.length && <Alert severity="info">أضف الأصناف المتوفرة من الروشتة — تم اقتراح المتوفر لديك تلقائياً.</Alert>}
        <Stack divider={<Divider flexItem />}>
          {lines.map((l) => (
            <Stack key={l.medicineId} direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
              <Typography sx={{ flex: 1, fontWeight: 600 }} dir="auto">{l.name}</Typography>
              <IconButton size="small" aria-label="زيادة" onClick={() => set(l.medicineId, l.quantity + 1)}><AddIcon fontSize="small" /></IconButton>
              <Typography sx={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{l.quantity}</Typography>
              <IconButton size="small" aria-label="تقليل" onClick={() => set(l.medicineId, l.quantity - 1)}>{l.quantity === 1 ? <DeleteOutline fontSize="small" /> : <RemoveIcon fontSize="small" />}</IconButton>
              <Typography variant="body2" sx={{ minWidth: 110, textAlign: 'left' }}>{l.quantity} × {fmtMoney(l.unitPrice)}</Typography>
            </Stack>
          ))}
        </Stack>
        <InventoryPicker exclude={lines.map((l) => l.medicineId)} onPick={(i) => setLines([...lines, { medicineId: i.medicine.id, name: medName(i.medicine), quantity: 1, unitPrice: i.price }])} />
        <TextField size="small" label="ملاحظة للمريض (بدائل، أصناف غير متوفرة…)" value={note} onChange={(e) => setNote(e.target.value)} multiline />
        <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: tokens.paper }}>
          <Stack direction="row" justifyContent="space-between"><Typography>الأصناف</Typography><Typography>{fmtMoney(subtotal)}</Typography></Stack>
          {o.fulfillment === 'DELIVERY' && <Stack direction="row" justifyContent="space-between"><Typography>التوصيل</Typography><Typography>{fee ? fmtMoney(fee) : 'مجاني'}</Typography></Stack>}
          <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>الإجمالي</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoney(subtotal + fee)}</Typography></Stack>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" startIcon={<CheckCircleOutline />} disabled={busy || !lines.length} onClick={submit}>{busy ? 'جاري التأكيد…' : 'تأكيد وحجز المخزون'}</Button>
          {onCancel && <Button onClick={onCancel}>رجوع</Button>}
        </Stack>
        <Typography variant="caption" color="text.secondary">عند التأكيد تُخصم الكميات من المخزون فوراً، وتعود تلقائياً إذا أُلغي الطلب.</Typography>
      </Stack>
    </Section>
  );
}

function DriverDialog({ open, onClose, onSubmit }) {
  const [f, setF] = useState({ driverName: '', driverPhone: '' });
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>خروج للتوصيل</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="اسم المندوب" value={f.driverName} onChange={(e) => setF({ ...f, driverName: e.target.value })} />
          <TextField label="موبايل المندوب" value={f.driverPhone} onChange={(e) => setF({ ...f, driverPhone: e.target.value })} inputProps={{ dir: 'ltr' }} />
          <Typography variant="caption" color="text.secondary">يظهر للمريض في صفحة تتبع الطلب.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={() => onSubmit(f).then(onClose).catch(() => {})}>تم الخروج</Button>
      </DialogActions>
    </Dialog>
  );
}

function DeliveredDialog({ open, onClose, total, onSubmit }) {
  const [method, setMethod] = useState('CASH');
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>تأكيد التسليم</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>استلام {fmtMoney(total)} من المريض</Typography>
        <TextField select fullWidth label="طريقة الدفع" value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(PAYMENT_METHOD).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
        </TextField>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" color="success" onClick={() => onSubmit(method).then(onClose).catch(() => {})}>تم التسليم</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function PhOrderWork() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data: o, isLoading, error, refetch } = usePhOrder(id);
  const [editing, setEditing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [driver, setDriver] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [busy, setBusy] = useState(false);
  useRealtime('pharmacy:order', (e) => e.id === id && qc.invalidateQueries({ queryKey: ['pharmacy-orders', id] }));
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={3} height={160} />;
  const refresh = () => {
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['pharmacy-orders'] });
    qc.invalidateQueries({ queryKey: ['pharmacy'] });
  };
  const status = async (body, ok) => {
    setBusy(true);
    try {
      await api.post(`/pharmacy-orders/${id}/status`, body);
      enqueueSnackbar(ok, { variant: 'success' });
      refresh();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const go = (s) => {
    if (s === 'OUT_FOR_DELIVERY') return setDriver(true);
    if (s === 'DELIVERED') return setDelivered(true);
    status({ status: s }, PH_STATUS[s].label).catch(() => {});
  };
  const showEditor = o.can.confirm && (editing || !o.items.length);
  const actions = [
    o.can.confirm && o.items.length > 0 && !editing && (
      <Button key="ok" variant="contained" disabled={busy} onClick={() => setEditing(true)} startIcon={<CheckCircleOutline />}>مراجعة وتأكيد</Button>
    ),
    ...o.can.transitions.map((s) => <Button key={s} variant="contained" disabled={busy} onClick={() => go(s)}>{PH_NEXT_LABEL[s]}</Button>),
    <Button key="print" startIcon={<PrintOutlined />} onClick={() => window.print()}>طباعة</Button>,
    o.can.chat && <ChatButton key="chat" payload={{ type: 'PATIENT_PROVIDER', providerId: o.pharmacy.providerId, patientId: o.patient.id }} label="مراسلة المريض" />,
    o.can.cancel && <Button key="c" color="error" onClick={() => setCancelOpen(true)}>إلغاء الطلب</Button>,
  ].filter(Boolean);
  return (
    <>
      <Button component={RouterLink} to="/provider/pharmacy-orders" startIcon={<ArrowForward />} sx={{ mb: 1, displayPrint: 'none' }}>الطلبات</Button>
      <PageHeader title={o.patient.fullName} subtitle={`${FULFILLMENT[o.fulfillment]} • ${o.code} • ${fmtDateTime(o.createdAt)}`} actions={actions} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
        <PhStatusChip value={o.status} size="medium" />
        {o.hasPrescription && <Chip size="small" variant="outlined" color="warning" label={o.prescription ? 'روشتة إلكترونية' : 'صورة روشتة'} />}
        <Chip size="small" variant="outlined" color={o.paymentStatus === 'PAID' ? 'success' : 'default'} label={o.paymentStatus === 'PAID' ? `مدفوع • ${PAYMENT_METHOD[o.paymentMethod] || ''}` : 'الدفع عند الاستلام'} />
        {o.cancelReason && <Typography color="text.secondary">السبب: {o.cancelReason}</Typography>}
      </Stack>
      <PhTrack status={o.status} fulfillment={o.fulfillment} />
      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid xs={12} lg={7}>
          <Stack spacing={2}>
            {o.prescription?.state && o.prescription.state !== 'ACTIVE' && o.prescription.state !== 'DISPENSED' && <Alert severity="error">الروشتة المرتبطة {o.prescription.stateLabel} — لا تصرف الأدوية المقررة بها.</Alert>}
            {showEditor ? (
              <ConfirmEditor o={o} onDone={refresh} onCancel={o.items.length ? () => setEditing(false) : undefined} />
            ) : (
              <Section title="الأصناف" action={o.can.confirm && <Button size="small" startIcon={<EditOutlined />} onClick={() => setEditing(true)}>تعديل</Button>}>
                <OrderLines items={o.items} subtotal={o.subtotal} deliveryFee={o.deliveryFee} total={o.total} fulfillment={o.fulfillment} />
                {o.pharmacistNote && <Alert severity="info" sx={{ mt: 1.5 }}>ملاحظتك للمريض: {o.pharmacistNote}</Alert>}
              </Section>
            )}
            {o.prescription && (
              <Section title="الروشتة الإلكترونية">
                <RxSheet rx={{ ...o.prescription, doctor: { fullName: o.prescription.doctorName }, patient: o.patient }} compact />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>تُسجَّل الروشتة «تم صرفها» تلقائياً عند تسليم الطلب.</Typography>
              </Section>
            )}
            {o.prescriptionFileId && (
              <Section title="صورة الروشتة المرفوعة">
                <ProtectedFile fileId={o.prescriptionFileId} label="فتح الصورة" />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>راجع الروشتة الورقية قبل صرف الأدوية التي تتطلب روشتة، وتحقق منها عند التسليم.</Typography>
              </Section>
            )}
          </Stack>
        </Grid>
        <Grid xs={12} lg={5}>
          <Stack spacing={2}>
            <Section title="المريض">
              <Typography sx={{ fontWeight: 700 }}>{o.patient.fullName}</Typography>
              <Typography variant="body2" dir="ltr" sx={{ textAlign: 'right' }}>{o.patient.phone}</Typography>
              {o.contactPhone && o.contactPhone !== o.patient.phone && <Typography variant="body2">رقم التواصل: <span dir="ltr">{o.contactPhone}</span></Typography>}
              {o.notes && <Alert severity="warning" sx={{ mt: 1 }}>ملاحظة المريض: {o.notes}</Alert>}
            </Section>
            <Section title={o.fulfillment === 'DELIVERY' ? 'عنوان التوصيل' : 'الاستلام من الفرع'}>
              {o.fulfillment === 'DELIVERY' ? <Typography>{o.deliveryAddress}</Typography> : <Typography>{o.branch?.name} — {o.branch?.address}</Typography>}
              {o.driverName && <Typography variant="body2" sx={{ mt: 1 }}>المندوب: {o.driverName} <span dir="ltr">{o.driverPhone}</span></Typography>}
            </Section>
            <Section title="سجل الطلب"><HistoryList history={o.history} labels={PH_STATUS} /></Section>
          </Stack>
        </Grid>
      </Grid>
      <DriverDialog open={driver} onClose={() => setDriver(false)} onSubmit={(f) => status({ status: 'OUT_FOR_DELIVERY', driverName: f.driverName || undefined, driverPhone: f.driverPhone || undefined }, 'خرج الطلب للتوصيل')} />
      <DeliveredDialog open={delivered} total={o.total} onClose={() => setDelivered(false)} onSubmit={(m) => status({ status: 'DELIVERED', paymentMethod: m }, 'تم تسليم الطلب')} />
      <ReasonDialog open={cancelOpen} title="إلغاء الطلب" body="تعود الكميات المحجوزة للمخزون ويصل للمريض إشعار بالسبب." label="سبب الإلغاء" required confirmText="إلغاء الطلب" danger onClose={() => setCancelOpen(false)}
        onSubmit={async (reason) => {
          try {
            await api.post(`/pharmacy-orders/${id}/cancel`, { reason });
            enqueueSnackbar('تم إلغاء الطلب', { variant: 'success' });
            refresh();
          } catch (e) {
            enqueueSnackbar(errorMessage(e), { variant: 'error' });
            throw e;
          }
        }}
      />
    </>
  );
}
