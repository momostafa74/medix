import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../../api/client';
import { PH_STATUS, RX_STATE, downloadRx, medName, phStages } from '../../api/pharmacy';
import { StatusChip, useDebounced } from '../common';
import { fmtDate, fmtMoney, fmtShortDate } from '../../utils/format';
import { tokens } from '../../theme';

export const PhStatusChip = ({ value, size }) => <StatusChip value={value} map={PH_STATUS} size={size} />;
export const RxStateChip = ({ value, size }) => <StatusChip value={value} map={RX_STATE} size={size} />;

export function PhTrack({ status, fulfillment }) {
  if (status === 'CANCELLED') return null;
  const stages = phStages(fulfillment);
  const idx = stages.findIndex((s) => s.statuses.includes(status));
  const last = stages.length - 1;
  return (
    <Stack direction="row" sx={{ my: 1 }}>
      {stages.map((s, i) => (
        <Box key={s.label} sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ height: 6, borderRadius: 3, mx: 0.25, bgcolor: i <= idx ? (i === idx && idx < last ? tokens.saffron : tokens.petrol) : tokens.line }} />
          <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5, textAlign: 'center', fontWeight: i === idx ? 700 : 400, color: i <= idx ? tokens.ink : 'text.secondary' }}>
            {s.label}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

/** The prescription as a paper-like sheet (patient, doctor, pharmacist). */
export function RxSheet({ rx, compact }) {
  return (
    <Box sx={{ border: `1px solid ${tokens.line}`, borderRadius: '12px', overflow: 'hidden', bgcolor: '#fff' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ p: 2, borderBottom: `3px solid ${tokens.petrol}` }}>
        <Box>
          <Typography sx={{ fontWeight: 700, color: tokens.petrol, fontSize: 18 }}>{rx.doctor?.fullName ? `د. ${rx.doctor.fullName.replace(/^د\.\s*/, '')}` : 'الطبيب'}</Typography>
          {rx.doctor?.specialty && <Typography variant="body2" color="text.secondary">{rx.doctor.specialty}</Typography>}
        </Box>
        <Stack alignItems="flex-end" spacing={0.5}>
          <Typography sx={{ fontFamily: 'serif', fontSize: 30, lineHeight: 1, color: tokens.petrol }} aria-hidden>℞</Typography>
          <RxStateChip value={rx.state} />
        </Stack>
      </Stack>
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ px: 2, py: 1.25, bgcolor: tokens.paper, borderBottom: `1px solid ${tokens.line}` }}>
        {rx.patient?.fullName && <Meta k="المريض" v={rx.patient.fullName} />}
        <Meta k="التاريخ" v={fmtShortDate(rx.issuedAt)} />
        <Meta k="رقم الروشتة" v={<span dir="ltr">{rx.code}</span>} />
        {rx.validUntil && <Meta k="صالحة حتى" v={fmtShortDate(rx.validUntil)} />}
      </Stack>
      <Box sx={{ p: 2 }}>
        {rx.diagnosis && (
          <Typography sx={{ mb: 1.5 }}>
            <b style={{ color: tokens.petrol }}>التشخيص:</b> {rx.diagnosis}
          </Typography>
        )}
        <Stack divider={<Divider flexItem sx={{ borderStyle: 'dashed' }} />}>
          {rx.items.map((i, n) => (
            <Stack key={i.id || n} direction="row" spacing={1.5} sx={{ py: 1 }}>
              <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: tokens.mint, color: tokens.petrol, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 13 }}>{n + 1}</Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 700 }} dir="auto">{i.medicineName}</Typography>
                <Typography variant="body2">
                  {i.dose} • {i.frequency} • لمدة {i.duration}
                  {i.quantity ? ` • ${i.quantity} عبوة` : ''}
                </Typography>
                {i.instructions && !compact && <Typography variant="body2" color="text.secondary">{i.instructions}</Typography>}
                {i.stock !== undefined && (
                  <Typography variant="caption" sx={{ color: i.stock?.inStock ? 'success.main' : tokens.signal }}>
                    {i.stock ? (i.stock.inStock ? `متوفر لديكم • ${fmtMoney(i.stock.price)}${i.stock.quantity != null ? ` • المخزون ${i.stock.quantity}` : ''}` : 'غير متوفر حالياً') : i.medicineId ? 'غير مُدرج في أصناف الصيدلية' : 'اسم حر (غير مرتبط بالدليل)'}
                  </Typography>
                )}
              </Box>
            </Stack>
          ))}
        </Stack>
        {rx.notes && !compact && (
          <Box sx={{ mt: 1.5, p: 1.25, borderInlineStart: `3px solid ${tokens.saffron}`, bgcolor: tokens.paper, borderRadius: '6px' }}>
            <Typography variant="body2"><b>ملاحظات:</b> {rx.notes}</Typography>
          </Box>
        )}
        {rx.state === 'REVOKED' && <Alert severity="error" sx={{ mt: 1.5 }}>ألغى الطبيب هذه الروشتة{rx.revokeReason ? `: ${rx.revokeReason}` : ''}.</Alert>}
        {rx.state === 'DISPENSED' && <Alert severity="info" sx={{ mt: 1.5 }}>تم صرفها {rx.dispensedBy ? `من ${rx.dispensedBy.nameAr}` : ''} {rx.dispensedAt ? `بتاريخ ${fmtShortDate(rx.dispensedAt)}` : ''}.</Alert>}
        {rx.state === 'EXPIRED' && <Alert severity="warning" sx={{ mt: 1.5 }}>انتهت صلاحية الروشتة — راجع طبيبك لتجديدها.</Alert>}
      </Box>
    </Box>
  );
}

const Meta = ({ k, v }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{k}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>{v}</Typography>
  </Box>
);

/** Catalog search (EN/AR/generic/barcode) — `freeSolo` lets doctors type a medicine that is not in the catalog. */
export function MedicineAutocomplete({ value, onChange, label = 'الدواء', freeSolo, kind, size, autoFocus, excludeIds = [] }) {
  const [input, setInput] = useState('');
  const q = useDebounced(input, 250);
  const { data, isFetching } = useQuery({
    queryKey: ['medicines', 'ac', q, kind],
    queryFn: () => api.get(`/medicines/search${qs({ search: q, kind, pageSize: 15 })}`).then((r) => r.data.items),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  });
  const options = (data || []).filter((m) => !excludeIds.includes(m.id));
  return (
    <Autocomplete
      freeSolo={freeSolo}
      size={size}
      options={options}
      value={value}
      filterOptions={(x) => x}
      loading={isFetching}
      getOptionLabel={(o) => (typeof o === 'string' ? o : medName(o))}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onInputChange={(_, v, reason) => {
        setInput(v);
        if (freeSolo && reason === 'input') onChange(v || null);
      }}
      onChange={(_, v) => onChange(v)}
      noOptionsText={q.length < 2 ? 'اكتب حرفين على الأقل' : 'لا توجد نتائج'}
      renderOption={(props, o) => (
        <li {...props} key={o.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600 }} dir="ltr" component="span">{medName(o)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {[o.nameAr, o.genericName].filter(Boolean).join(' • ')}
              {o.requiresPrescription ? ' • بروشتة' : ''}
              {o.minPrice != null ? ` • من ${fmtMoney(o.minPrice)}` : ''}
            </Typography>
          </Box>
        </li>
      )}
      renderInput={(p) => (
        <TextField
          {...p}
          label={label}
          autoFocus={autoFocus}
          InputProps={{ ...p.InputProps, endAdornment: <>{isFetching ? <CircularProgress size={16} /> : null}{p.InputProps.endAdornment}</> }}
        />
      )}
    />
  );
}

const EMPTY_ITEM = () => ({ medicine: null, dose: '', frequency: '', duration: '', quantity: '', instructions: '' });
const DOSES = ['قرص واحد', 'قرصين', 'كبسولة', '5 مل', '10 مل', 'بخة', 'نقطتين', 'دهان طبقة رقيقة'];
const FREQS = ['مرة يومياً', 'مرتين يومياً', '3 مرات يومياً', 'كل 8 ساعات', 'كل 12 ساعة', 'عند اللزوم', 'قبل النوم'];
const DURS = ['3 أيام', '5 أيام', '7 أيام', '10 أيام', '14 يوم', '30 يوم', 'مستمر'];

const Suggest = ({ label, options, value, onChange }) => (
  <Autocomplete freeSolo size="small" options={options} value={value} onInputChange={(_, v) => onChange(v)} renderInput={(p) => <TextField {...p} label={label} required />} />
);

/** Doctor writes an e-prescription for a patient they treat. */
export function RxWriterDialog({ open, onClose, patient, appointments = [], onCreated }) {
  const { enqueueSnackbar } = useSnackbar();
  const [items, setItems] = useState([EMPTY_ITEM()]);
  const [f, setF] = useState({ diagnosis: '', notes: '', validDays: 30, appointmentId: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setItems([EMPTY_ITEM()]);
      setF({ diagnosis: '', notes: '', validDays: 30, appointmentId: appointments[0]?.id || '' });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i, patch) => setItems(items.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const valid = items.length && items.every((i) => i.medicine && i.dose.trim() && i.frequency.trim() && i.duration.trim());
  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/prescriptions', {
        patientId: patient.id,
        appointmentId: f.appointmentId || undefined,
        diagnosis: f.diagnosis || undefined,
        notes: f.notes || undefined,
        validDays: Number(f.validDays) || undefined,
        items: items.map((i) => ({
          ...(typeof i.medicine === 'string' ? { medicineName: i.medicine } : { medicineId: i.medicine.id }),
          dose: i.dose,
          frequency: i.frequency,
          duration: i.duration,
          quantity: i.quantity ? Number(i.quantity) : undefined,
          instructions: i.instructions || undefined,
        })),
      });
      enqueueSnackbar('تم إصدار الروشتة وإرسالها للمريض', { variant: 'success' });
      onCreated?.(data);
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>روشتة إلكترونية — {patient?.fullName}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid xs={12} md={appointments.length ? 6 : 12}>
            <TextField fullWidth size="small" label="التشخيص" value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} />
          </Grid>
          {!!appointments.length && (
            <Grid xs={12} md={6}>
              <TextField fullWidth select size="small" label="مرتبطة بالزيارة" value={f.appointmentId} onChange={(e) => setF({ ...f, appointmentId: e.target.value })}>
                <MenuItem value="">بدون</MenuItem>
                {appointments.map((a) => <MenuItem key={a.id} value={a.id}>{fmtDate(a.startAt)} — {a.code}</MenuItem>)}
              </TextField>
            </Grid>
          )}
        </Grid>
        <Stack spacing={2} sx={{ mt: 2 }}>
          {items.map((it, i) => (
            <Box key={i} sx={{ p: 1.5, borderRadius: '12px', border: `1px solid ${tokens.line}`, bgcolor: tokens.paper }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: tokens.petrol, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{i + 1}</Box>
                <Box sx={{ flex: 1 }}>
                  <MedicineAutocomplete freeSolo size="small" value={it.medicine} onChange={(v) => set(i, { medicine: v })} label="اسم الدواء (من الدليل أو اكتب الاسم)" autoFocus={i === items.length - 1 && i > 0} />
                </Box>
                <IconButton aria-label="حذف الدواء" disabled={items.length === 1} onClick={() => setItems(items.filter((_, n) => n !== i))}><DeleteOutline /></IconButton>
              </Stack>
              {it.medicine && typeof it.medicine === 'string' && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>اسم غير موجود في الدليل — سيُكتب كما هو ولن يظهر للصيدلية سعره تلقائياً.</Typography>}
              <Grid container spacing={1.5}>
                <Grid xs={12} sm={4}><Suggest label="الجرعة" options={DOSES} value={it.dose} onChange={(v) => set(i, { dose: v })} /></Grid>
                <Grid xs={12} sm={4}><Suggest label="التكرار" options={FREQS} value={it.frequency} onChange={(v) => set(i, { frequency: v })} /></Grid>
                <Grid xs={8} sm={3}><Suggest label="المدة" options={DURS} value={it.duration} onChange={(v) => set(i, { duration: v })} /></Grid>
                <Grid xs={4} sm={1}><TextField size="small" label="عبوات" type="number" value={it.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/\D/g, '').slice(0, 2) })} inputProps={{ min: 1, max: 99 }} /></Grid>
                <Grid xs={12}><TextField size="small" fullWidth label="تعليمات (مثال: بعد الأكل)" value={it.instructions} onChange={(e) => set(i, { instructions: e.target.value })} /></Grid>
              </Grid>
            </Box>
          ))}
          <Button startIcon={<AddIcon />} onClick={() => setItems([...items, EMPTY_ITEM()])} disabled={items.length >= 20} sx={{ alignSelf: 'flex-start' }}>إضافة دواء</Button>
          <Grid container spacing={2}>
            <Grid xs={12} md={9}><TextField fullWidth multiline minRows={2} size="small" label="ملاحظات للمريض" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Grid>
            <Grid xs={12} md={3}><TextField fullWidth size="small" type="number" label="صالحة لمدة (يوم)" value={f.validDays} onChange={(e) => setF({ ...f, validDays: e.target.value })} inputProps={{ min: 1, max: 365 }} /></Grid>
          </Grid>
          <Alert severity="info" sx={{ py: 0 }}>تصل الروشتة للمريض فوراً مع PDF ورمز QR؛ تستطيع الصيدلية التحقق منها وتسجيل صرفها مرة واحدة فقط.</Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={busy}>إلغاء</Button>
        <Button variant="contained" onClick={submit} disabled={!valid || busy}>{busy ? 'جاري الإصدار…' : 'إصدار الروشتة'}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Prescriptions in a patient's medical record (patient & treating providers). */
export function PrescriptionsHistory({ patientId, action }) {
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error } = useQuery({
    queryKey: ['prescriptions', 'history', patientId],
    queryFn: () => api.get(`/patients/${patientId}/prescriptions`).then((r) => r.data),
    enabled: !!patientId,
  });
  const [open, setOpen] = useState(null);
  if (error) return <Typography color="text.secondary">{error.response?.status === 403 ? 'لا تملك صلاحية عرض الروشتات.' : 'تعذر تحميل الروشتات.'}</Typography>;
  if (isLoading) return <Skeleton variant="rounded" height={100} />;
  return (
    <Stack spacing={1}>
      {action}
      {!data.length && <Typography color="text.secondary">لا توجد روشتات إلكترونية.</Typography>}
      {data.map((rx) => {
        const isOpen = open === rx.id;
        return (
          <Box key={rx.id} sx={{ borderRadius: '10px', border: `1px solid ${tokens.line}` }}>
            <ButtonBase onClick={() => setOpen(isOpen ? null : rx.id)} sx={{ width: '100%', p: 1.5, justifyContent: 'space-between', textAlign: 'right', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }} noWrap>{rx.diagnosis || rx.items.map((i) => i.medicineName).join('، ')}</Typography>
                <Typography variant="caption" color="text.secondary">د. {rx.doctor?.fullName} • {fmtShortDate(rx.issuedAt)} • {rx.items.length} دواء</Typography>
              </Box>
              <RxStateChip value={rx.state} />
            </ButtonBase>
            {isOpen && (
              <Box sx={{ px: 1.5, pb: 1.5 }}>
                <RxSheet rx={rx} />
                <Button size="small" startIcon={<PictureAsPdfOutlined />} sx={{ mt: 1 }} onClick={() => downloadRx(rx).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>PDF</Button>
              </Box>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

/** Order lines with totals. */
export function OrderLines({ items, subtotal, deliveryFee, total, fulfillment, discount }) {
  return (
    <Stack spacing={0.75}>
      {items.map((i) => (
        <Stack key={i.id || i.medicineId} direction="row" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} dir="auto">{i.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {i.quantity} × {fmtMoney(i.unitPrice)}
              {i.requiresPrescription ? ' • بروشتة' : ''}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtMoney(i.lineTotal ?? i.quantity * i.unitPrice)}</Typography>
        </Stack>
      ))}
      <Divider />
      <Row k="الأصناف" v={fmtMoney(subtotal)} />
      {fulfillment !== 'PICKUP' && <Row k="التوصيل" v={deliveryFee ? fmtMoney(deliveryFee) : 'مجاني'} />}
      {Number(discount) > 0 && <Row k="خصم الكوبون" v={<Box component="span" sx={{ color: 'success.main' }}>− {fmtMoney(discount)}</Box>} />}
      <Row k={<b>الإجمالي</b>} v={<b>{fmtMoney(total)}</b>} />
    </Stack>
  );
}
const Row = ({ k, v }) => (
  <Stack direction="row" justifyContent="space-between">
    <Typography variant="body2">{k}</Typography>
    <Typography variant="body2">{v}</Typography>
  </Stack>
);

export function useCartTotals(lines, rules, fulfillment) {
  return useMemo(() => {
    const subtotal = Math.round(lines.reduce((s, l) => s + l.quantity * l.price, 0) * 100) / 100;
    let deliveryFee = 0;
    let blocked = null;
    if (fulfillment === 'DELIVERY' && rules) {
      if (!rules.deliveryAvailable) blocked = 'الصيدلية لا توفر التوصيل حالياً';
      else if (lines.length && subtotal < (rules.minOrderForDelivery || 0)) blocked = `الحد الأدنى لطلبات التوصيل ${fmtMoney(rules.minOrderForDelivery)}`;
      else deliveryFee = rules.freeDeliveryOver != null && subtotal >= rules.freeDeliveryOver ? 0 : Number(rules.deliveryFee || 0);
    }
    return { subtotal, deliveryFee, total: subtotal + deliveryFee, blocked };
  }, [lines, rules, fulfillment]);
}
