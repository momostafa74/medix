import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ArrowForward from '@mui/icons-material/ArrowForward';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import JsBarcode from 'jsbarcode';
import { api, downloadFile, errorMessage } from '../../api/client';
import { downloadLabReport, LAB_STATUS, NEXT_ACTION_LABEL, PAYMENT_METHOD, useLabOrder } from '../../api/labs';
import { useRealtime } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section, useConfirm } from '../../components/common';
import { CriticalBanner, FlagChip, HistoryList, ItemsSummary, LabStatusChip } from '../../components/lab/LabUi';
import ReasonDialog from '../../components/lab/ReasonDialog';
import ChatButton from '../../components/ChatButton';
import { fmtDate, fmtDateTime, fmtMoney, fmtTime } from '../../utils/format';
import { GENDER } from '../../utils/labels';
import { tokens } from '../../theme';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 50×30 mm tube labels with CODE128 barcodes, printed from a dedicated window. */
function printLabels(order, samples) {
  const labels = samples.map((s) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, s.barcode, { format: 'CODE128', width: 1.6, height: 38, fontSize: 11, margin: 0 });
    return `<div class="l"><div class="n">${esc(order.patient.fullName)}</div><div class="m">${esc(s.sampleType)} • ${esc(s.testsLabel || '')}</div>${svg.outerHTML}<div class="m">${esc(order.code)}</div></div>`;
  });
  const w = window.open('', '_blank', 'width=420,height=600');
  if (!w) return false;
  w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(order.code)}</title><style>
    @page{size:50mm 30mm;margin:0} body{margin:0;font-family:system-ui,sans-serif}
    .l{width:50mm;height:30mm;padding:1.5mm;box-sizing:border-box;page-break-after:always;text-align:center;overflow:hidden}
    .n{font-weight:700;font-size:10px;white-space:nowrap;overflow:hidden} .m{font-size:8px;white-space:nowrap;overflow:hidden;direction:ltr} svg{max-width:100%;height:15mm}
  </style></head><body>${labels.join('')}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}

const parseNum = (raw) => {
  const s = String(raw).trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[٫,]/g, '.').replace(/^[<>≤≥]=?\s*/, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

/** Same rule the server applies — shown live while typing; the server's flag is the one stored. */
function previewFlag(value, p) {
  if (!String(value).trim()) return null;
  if (p.resultType === 'TEXT') return null;
  const n = parseNum(value);
  if (n === null) return 'INVALID';
  const r = p.range;
  if (!r) return 'NORMAL';
  if ((r.criticalLow != null && n < r.criticalLow) || (r.criticalHigh != null && n > r.criticalHigh)) return 'CRITICAL';
  if (r.low != null && n < r.low) return 'LOW';
  if (r.high != null && n > r.high) return 'HIGH';
  return 'NORMAL';
}

function Worksheet({ orderId, onChanged }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const { data: ws, isLoading, error, refetch } = useQuery({ queryKey: ['lab-orders', orderId, 'worksheet'], queryFn: () => api.get(`/lab-orders/${orderId}/worksheet`).then((r) => r.data) });
  const [values, setValues] = useState({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  useEffect(() => {
    if (!ws) return;
    const v = {};
    ws.tests.forEach((t) => t.parameters.forEach((p) => (v[p.id] = { value: p.value || '', flag: p.flag || 'NORMAL', notes: p.notes || '' })));
    setValues(v);
    setNotes(ws.result?.notes || '');
  }, [ws]);
  const params = useMemo(() => ws?.tests.flatMap((t) => t.parameters) || [], [ws]);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <Skeleton variant="rounded" height={260} />;
  const can = ws.can;
  const editable = can.enterResults;
  const filled = params.filter((p) => String(values[p.id]?.value || '').trim()).length;
  const dirty = params.some((p) => (values[p.id]?.value || '') !== (p.value || '') || (values[p.id]?.notes || '') !== (p.notes || '') || (p.resultType === 'TEXT' && (values[p.id]?.flag || 'NORMAL') !== (p.flag || 'NORMAL'))) || notes !== (ws.result?.notes || '');
  const invalid = params.some((p) => previewFlag(values[p.id]?.value || '', p) === 'INVALID');
  const set = (id, patch) => setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lab-orders', orderId] });
    onChanged?.();
  };
  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      enqueueSnackbar(ok, { variant: 'success' });
      refresh();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(
      () => api.put(`/lab-orders/${orderId}/results`, {
        items: params.map((p) => ({ parameterId: p.id, value: values[p.id]?.value || '', flag: p.resultType === 'TEXT' ? values[p.id]?.flag : undefined, notes: values[p.id]?.notes || undefined })),
        notes,
      }),
      'تم حفظ النتائج',
    );
  return (
    <Section
      title="ورقة النتائج"
      action={<Typography variant="body2" color="text.secondary">{filled} / {params.length} بند</Typography>}
    >
      <Stack spacing={1.5}>
        {ws.result?.returnNote && <Alert severity="warning">أعادها المراجع للتصحيح: {ws.result.returnNote}</Alert>}
        <CriticalBanner count={ws.result?.criticalCount} />
        <Typography variant="body2" color="text.secondary">
          {ws.patient.fullName} • {GENDER[ws.patient.gender] || 'النوع غير محدد'} • {ws.patient.ageYears != null ? `${ws.patient.ageYears} سنة` : 'السن غير محدد'} — المعدلات الطبيعية مختارة حسب النوع والسن.
        </Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 640 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: '26%' }}>البند</TableCell>
                <TableCell sx={{ width: '20%' }}>النتيجة</TableCell>
                <TableCell>الوحدة</TableCell>
                <TableCell>المعدل الطبيعي</TableCell>
                <TableCell>الحالة</TableCell>
                <TableCell sx={{ width: '22%' }}>ملاحظة</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ws.tests.map((t) => (
                <Fragment key={t.testId}>
                  <TableRow>
                    <TableCell colSpan={6} sx={{ bgcolor: tokens.paper }}>
                      <Typography sx={{ fontWeight: 700, color: tokens.petrol }}>{t.name} <Typography component="span" variant="caption" color="text.secondary" dir="ltr">{t.code}</Typography></Typography>
                    </TableCell>
                  </TableRow>
                  {t.parameters.map((p) => {
                    const v = values[p.id] || { value: '', flag: 'NORMAL', notes: '' };
                    const live = p.resultType === 'TEXT' ? (v.value ? v.flag : null) : previewFlag(v.value, p);
                    return (
                      <TableRow key={p.id} sx={{ bgcolor: live === 'CRITICAL' ? '#FBEDEA' : live && live !== 'NORMAL' && live !== 'INVALID' ? '#FFF8EC' : undefined }}>
                        <TableCell><Typography sx={{ fontWeight: 600 }} dir="auto">{p.name}</Typography></TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={v.value}
                            disabled={!editable}
                            onChange={(e) => set(p.id, { value: e.target.value })}
                            error={live === 'INVALID'}
                            helperText={live === 'INVALID' ? 'رقم فقط' : undefined}
                            inputProps={{ dir: 'ltr', inputMode: p.resultType === 'TEXT' ? 'text' : 'decimal', 'aria-label': p.name, style: { fontWeight: 700 } }}
                          />
                        </TableCell>
                        <TableCell><Typography variant="body2" dir="ltr">{p.unit}</Typography></TableCell>
                        <TableCell><Typography variant="body2" color="text.secondary" dir="ltr" sx={{ textAlign: 'right' }}>{p.referenceRange || '—'}</Typography></TableCell>
                        <TableCell>
                          {p.resultType === 'TEXT' ? (
                            <TextField select size="small" value={v.flag} disabled={!editable} onChange={(e) => set(p.id, { flag: e.target.value })} sx={{ minWidth: 96 }}>
                              {['NORMAL', 'HIGH', 'LOW', 'CRITICAL'].map((f) => <MenuItem key={f} value={f}>{{ NORMAL: 'طبيعي', HIGH: 'مرتفع', LOW: 'منخفض', CRITICAL: 'حرج' }[f]}</MenuItem>)}
                            </TextField>
                          ) : live && live !== 'INVALID' ? <FlagChip flag={live} /> : null}
                        </TableCell>
                        <TableCell><TextField size="small" value={v.notes} disabled={!editable} onChange={(e) => set(p.id, { notes: e.target.value })} inputProps={{ 'aria-label': `ملاحظة ${p.name}` }} /></TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TextField label="ملاحظات عامة على التقرير" multiline minRows={2} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
        {ws.result && (
          <Typography variant="caption" color="text.secondary">
            {ws.result.enteredBy && `أدخلها ${ws.result.enteredBy} (${fmtDateTime(ws.result.enteredAt)})`}
            {ws.result.reviewedBy && ` • راجعها ${ws.result.reviewedBy}`}
            {ws.result.approvedBy && ` • اعتمدها ${ws.result.approvedBy} (${fmtDateTime(ws.result.approvedAt)})`}
          </Typography>
        )}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {editable && <Button variant="contained" startIcon={<SaveOutlined />} disabled={busy || !dirty || invalid} onClick={() => save().catch(() => {})}>حفظ</Button>}
          {can.submitForReview && (
            <Button variant="outlined" startIcon={<SendOutlined />} disabled={busy || dirty} onClick={() => run(() => api.post(`/lab-orders/${orderId}/results/submit`), 'أُرسلت النتائج للمراجعة').catch(() => {})}>
              إرسال للمراجعة
            </Button>
          )}
          {can.review && !ws.result?.reviewedAt && (
            <Button variant="outlined" startIcon={<FactCheckOutlined />} disabled={busy} onClick={() => run(() => api.post(`/lab-orders/${orderId}/results/review`, {}), 'تم تسجيل المراجعة').catch(() => {})}>تمت المراجعة</Button>
          )}
          {can.review && <Button color="warning" startIcon={<UndoOutlined />} disabled={busy} onClick={() => setReturnOpen(true)}>إعادة للتصحيح</Button>}
          {can.approve && (
            <Button
              variant="contained"
              color="success"
              startIcon={<VerifiedOutlined />}
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({ title: 'اعتماد النتيجة', body: `بعد الاعتماد تصل النتيجة للمريض فوراً ويصدر التقرير PDF برمز تحقق.${ws.result?.criticalCount ? ' النتيجة تحتوي على قيم حرجة وسيتم تنبيه المريض بشكل عاجل.' : ''}`, confirmText: 'اعتماد وإرسال' });
                if (ok) run(() => api.post(`/lab-orders/${orderId}/results/approve`), 'تم اعتماد النتيجة وإرسالها للمريض').catch(() => {});
              }}
            >
              اعتماد وإرسال للمريض
            </Button>
          )}
          {ws.status === 'UNDER_REVIEW' && !can.approve && !can.review && <Alert severity="info" sx={{ py: 0 }}>بانتظار الاعتماد من مدير المعمل.</Alert>}
          {ws.status === 'UNDER_REVIEW' && can.review && !can.approve && <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>الاعتماد النهائي لمدير المعمل.</Typography>}
        </Stack>
      </Stack>
      <ReasonDialog
        open={returnOpen}
        title="إعادة النتائج للتصحيح"
        label="ما الذي يحتاج تصحيح؟"
        required
        confirmText="إعادة"
        onClose={() => setReturnOpen(false)}
        onSubmit={(note) => run(() => api.post(`/lab-orders/${orderId}/results/return`, { note }), 'أُعيدت النتائج لمن أدخلها')}
      />
    </Section>
  );
}

export default function LabOrderWork() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data: o, isLoading, error, refetch } = useLabOrder(id);
  const [payAnchor, setPayAnchor] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState(false);
  useRealtime('lab:order', (e) => e.id === id && qc.invalidateQueries({ queryKey: ['lab-orders', id] }));
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={3} height={160} />;
  const refresh = () => qc.invalidateQueries({ queryKey: ['lab-orders'] });
  const act = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      enqueueSnackbar(ok, { variant: 'success' });
      refresh();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const live = o.samples.filter((s) => !s.rejectedAt);
  const showWorksheet = o.can.viewResults || o.can.enterResults;
  const actions = [
    ...o.can.transitions.filter((s) => s !== 'PAID').map((s) => (
      <Button key={s} variant="contained" disabled={busy} onClick={() => act(() => api.post(`/lab-orders/${id}/status`, { status: s }), LAB_STATUS[s].label).catch(() => {})}>
        {NEXT_ACTION_LABEL[s] || LAB_STATUS[s].label}
      </Button>
    )),
    o.can.recordPayment && (
      <Button key="pay" variant="outlined" startIcon={<PaymentsOutlined />} disabled={busy} onClick={(e) => setPayAnchor(e.currentTarget)}>تسجيل الدفع</Button>
    ),
    live.length > 0 && (
      <Button key="print" variant="outlined" startIcon={<PrintOutlined />} onClick={() => printLabels(o, live) || enqueueSnackbar('اسمح بالنوافذ المنبثقة للطباعة', { variant: 'warning' })}>طباعة الملصقات</Button>
    ),
    o.can.previewReport && (
      <Button key="draft" startIcon={<PictureAsPdfOutlined />} onClick={() => downloadFile(`/lab-orders/${id}/report.pdf`, `draft-${o.code}.pdf`).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>معاينة التقرير</Button>
    ),
    o.can.downloadReport && (
      <Button key="pdf" startIcon={<PictureAsPdfOutlined />} onClick={() => downloadLabReport(o).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>التقرير PDF</Button>
    ),
    o.can.chat && <ChatButton key="chat" payload={{ type: 'PATIENT_PROVIDER', providerId: o.laboratory.providerId, patientId: o.patient.id }} label="مراسلة المريض" />,
    o.can.cancel && <Button key="cancel" color="error" onClick={() => setCancelOpen(true)}>إلغاء الطلب</Button>,
  ].filter(Boolean);
  return (
    <>
      <Button component={RouterLink} to="/provider/orders" startIcon={<ArrowForward />} sx={{ mb: 1 }}>الطلبات</Button>
      <PageHeader title={<span dir="ltr">{o.code}</span>} subtitle={`${o.patient.fullName} • ${o.homeCollection ? 'سحب منزلي' : o.branch?.name}`} actions={actions} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <LabStatusChip value={o.status} size="medium" />
        <Chip size="small" variant="outlined" color={o.paymentStatus === 'PAID' ? 'success' : 'default'} label={o.paymentStatus === 'PAID' ? `مدفوع • ${PAYMENT_METHOD[o.paymentMethod] || ''}` : 'لم يُدفع'} />
        {o.status === 'CANCELLED' && o.cancelReason && <Typography color="text.secondary">السبب: {o.cancelReason}</Typography>}
      </Stack>
      <Grid container spacing={2}>
        <Grid xs={12} lg={8}>
          <Stack spacing={2}>
            {showWorksheet ? (
              <Worksheet orderId={id} onChanged={refresh} />
            ) : (
              o.status !== 'CANCELLED' && (
                <Alert severity="info">
                  إدخال النتائج يبدأ بعد {o.status === 'SAMPLE_RECEIVED' ? 'الضغط على "بدء التحليل"' : 'سحب العينة واستلامها بالمعمل'}.
                </Alert>
              )
            )}
            <Section title="التحاليل المطلوبة"><ItemsSummary items={o.items} /></Section>
          </Stack>
        </Grid>
        <Grid xs={12} lg={4}>
          <Stack spacing={2}>
            <Section title="المريض">
              <Typography sx={{ fontWeight: 700 }}>{o.patient.fullName}</Typography>
              <Typography variant="body2" color="text.secondary">{GENDER[o.patient.gender] || '—'} • {o.patient.ageYears != null ? `${o.patient.ageYears} سنة` : 'السن غير مسجل'}</Typography>
              <Typography variant="body2" dir="ltr" sx={{ textAlign: 'right' }}>{o.patient.phone}</Typography>
              {o.contactPhone && <Typography variant="body2">رقم التواصل: <span dir="ltr">{o.contactPhone}</span></Typography>}
              {o.notes && <Alert severity="info" sx={{ mt: 1 }}>{o.notes}</Alert>}
            </Section>
            <Section title="الموعد والمكان">
              <Typography sx={{ fontWeight: 600 }}>{fmtDate(o.scheduledAt)} — {fmtTime(o.scheduledAt)}</Typography>
              <Typography variant="body2" color="text.secondary">{o.homeCollection ? o.homeAddress : `${o.branch?.name} • ${o.branch?.address}`}</Typography>
              <Divider sx={{ my: 1 }} />
              {o.homeFee > 0 && <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">رسوم السحب</Typography><Typography>{fmtMoney(o.homeFee)}</Typography></Stack>}
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>الإجمالي</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoney(o.total)}</Typography></Stack>
            </Section>
            <Section title="العينات">
              {o.samples.length ? (
                <Stack spacing={1}>
                  {o.samples.map((s) => (
                    <Box key={s.id} sx={{ p: 1.25, borderRadius: '10px', border: `1px solid ${tokens.line}`, opacity: s.rejectedAt ? 0.6 : 1 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography dir="ltr" sx={{ fontWeight: 700, fontFamily: 'monospace', textDecoration: s.rejectedAt ? 'line-through' : 'none' }}>{s.barcode}</Typography>
                        {o.can.rejectSample && !s.rejectedAt && s.collectedAt && (
                          <Tooltip title="رفض العينة وطلب إعادة السحب">
                            <IconButton size="small" color="error" onClick={() => setRejecting(s)} aria-label="رفض العينة"><BlockOutlined fontSize="small" /></IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                      <Typography variant="body2">{s.sampleType} • <span dir="ltr">{s.testsLabel}</span></Typography>
                      <Typography variant="caption" color="text.secondary">
                        {s.rejectedAt ? `مرفوضة: ${s.rejectReason}` : s.receivedAt ? `استُلمت ${fmtDateTime(s.receivedAt)}` : s.collectedAt ? `سُحبت ${fmtDateTime(s.collectedAt)}` : 'بانتظار السحب'}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography color="text.secondary">تُنشأ العينات وأكواد الباركود تلقائياً عند تسجيل «تم سحب العينة».</Typography>
              )}
            </Section>
            <Section title="سجل الطلب"><HistoryList history={o.history} /></Section>
          </Stack>
        </Grid>
      </Grid>
      <Menu anchorEl={payAnchor} open={!!payAnchor} onClose={() => setPayAnchor(null)}>
        {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
          <MenuItem key={k} onClick={() => { setPayAnchor(null); act(() => api.post(`/lab-orders/${id}/payment`, { paymentMethod: k }), `تم تسجيل الدفع (${v})`).catch(() => {}); }}>
            <ListItemText primary={v} secondary={fmtMoney(o.total)} />
          </MenuItem>
        ))}
      </Menu>
      <ReasonDialog open={cancelOpen} title="إلغاء الطلب" body="سيصل للمريض إشعار بالإلغاء والسبب." label="سبب الإلغاء" required confirmText="إلغاء الطلب" danger onClose={() => setCancelOpen(false)} onSubmit={(reason) => act(() => api.post(`/lab-orders/${id}/cancel`, { reason }), 'تم إلغاء الطلب')} />
      <ReasonDialog
        open={!!rejecting}
        title={`رفض العينة ${rejecting?.barcode || ''}`}
        body="سيُنشأ باركود جديد ويعود الطلب لمرحلة السحب، ويصل للمريض إشعار بإعادة السحب."
        label="سبب الرفض (تحلل، كمية غير كافية…)"
        required
        confirmText="رفض العينة"
        danger
        onClose={() => setRejecting(null)}
        onSubmit={(reason) => act(() => api.post(`/lab-orders/${id}/samples/${rejecting.id}/reject`, { reason }), 'تم رفض العينة')}
      />
    </>
  );
}
