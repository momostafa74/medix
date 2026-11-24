import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, Divider, FormControlLabel, IconButton, ListItemText, Menu, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ArrowForward from '@mui/icons-material/ArrowForward';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import ContentCopy from '@mui/icons-material/ContentCopy';
import OpenInNew from '@mui/icons-material/OpenInNewOutlined';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, downloadFile, errorMessage } from '../../api/client';
import { PAYMENT_METHOD } from '../../api/labs';
import { RAD_NEXT_LABEL, RAD_STATUS, downloadRadReport, useRadOrder } from '../../api/radiology';
import { useRealtime } from '../../auth/AuthProvider';
import { ErrorState, ListSkeleton, PageHeader, Section, useConfirm } from '../../components/common';
import { HistoryList } from '../../components/lab/LabUi';
import ReasonDialog from '../../components/lab/ReasonDialog';
import { ImageGallery, RadStatusChip, ReportView } from '../../components/radiology/RadUi';
import FileUploadButton from '../../components/FileUploadButton';
import ProtectedFile from '../../components/ProtectedFile';
import ChatButton from '../../components/ChatButton';
import { fmtDate, fmtDateTime, fmtMoney, fmtTime } from '../../utils/format';
import { GENDER } from '../../utils/labels';

const FIELDS = [
  { key: 'technique', label: 'طريقة الفحص (Technique)', rows: 2 },
  { key: 'comparison', label: 'المقارنة بفحوصات سابقة', rows: 1 },
  { key: 'findings', label: 'النتائج (Findings)', rows: 8, required: true },
  { key: 'impression', label: 'الخلاصة (Impression)', rows: 3, required: true },
  { key: 'recommendations', label: 'التوصيات', rows: 2 },
];

function ReportEditor({ o, onDone }) {
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  useEffect(() => {
    const r = o.report;
    setF({
      technique: r?.technique || '',
      comparison: r?.comparison || '',
      findings: r?.findings ?? o.reportTemplate ?? '',
      impression: r?.impression || '',
      recommendations: r?.recommendations || '',
      critical: !!r?.critical,
    });
  }, [o]);
  if (!f) return null;
  const can = o.can;
  const editable = can.writeReport;
  const r = o.report;
  const dirty = !r || FIELDS.some((x) => (r[x.key] || '') !== f[x.key]) || !!r.critical !== f.critical;
  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      enqueueSnackbar(ok, { variant: 'success' });
      onDone();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => api.put(`/radiology-orders/${o.id}/report`, f), 'تم حفظ التقرير');
  if (!editable && r && ['APPROVED', 'DELIVERED'].includes(o.status)) {
    return <Section title="التقرير المعتمد"><ReportView report={r} indication={o.clinicalIndication} /></Section>;
  }
  return (
    <Section title="تقرير الأشعة" action={r?.submittedAt ? <Chip color="secondary" label="بانتظار الاعتماد" /> : r ? <Chip variant="outlined" label="مسودة" /> : null}>
      <Stack spacing={1.5}>
        {r?.returnNote && <Alert severity="warning">أُعيد للتصحيح: {r.returnNote}</Alert>}
        {o.clinicalIndication && <Alert severity="info">سبب الفحص: {o.clinicalIndication}{o.referringDoctor ? ` — المحوِّل: ${o.referringDoctor}` : ''}</Alert>}
        {FIELDS.map((x) => (
          <TextField
            key={x.key}
            label={x.label}
            required={x.required}
            multiline
            minRows={x.rows}
            value={f[x.key]}
            disabled={!editable}
            onChange={(e) => setF({ ...f, [x.key]: e.target.value })}
            inputProps={{ dir: 'auto', style: { lineHeight: 1.7 } }}
          />
        ))}
        <FormControlLabel control={<Switch color="error" checked={f.critical} disabled={!editable} onChange={(e) => setF({ ...f, critical: e.target.checked })} />} label="نتيجة عاجلة / حرجة (يصل للمريض تنبيه عاجل عند الاعتماد)" />
        {r && (
          <Typography variant="caption" color="text.secondary">
            {r.reportedById && `كتبه ${r.names?.[r.reportedById] || ''} (${fmtDateTime(r.reportedAt)})`}
          </Typography>
        )}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {editable && <Button variant="contained" startIcon={<SaveOutlined />} disabled={busy || !dirty || f.findings.trim().length < 3 || !f.impression.trim()} onClick={() => save().catch(() => {})}>حفظ المسودة</Button>}
          {can.submitReport && <Button variant="outlined" startIcon={<SendOutlined />} disabled={busy || dirty} onClick={() => run(() => api.post(`/radiology-orders/${o.id}/report/submit`), 'أُرسل التقرير للاعتماد').catch(() => {})}>إرسال للاعتماد</Button>}
          {can.returnReport && <Button color="warning" startIcon={<UndoOutlined />} disabled={busy} onClick={() => setReturnOpen(true)}>إعادة للتصحيح</Button>}
          {can.approve && (
            <Button variant="contained" color="success" startIcon={<VerifiedOutlined />} disabled={busy}
              onClick={async () => {
                if (await confirm({ title: 'اعتماد التقرير', body: `بعد الاعتماد يصل التقرير للمريض فوراً مع PDF برمز تحقق.${r?.critical ? ' التقرير مُعلَّم كعاجل وسيصل للمريض تنبيه عاجل.' : ''}`, confirmText: 'اعتماد وإرسال' })) {
                  run(() => api.post(`/radiology-orders/${o.id}/report/approve`), 'تم اعتماد التقرير وإرساله للمريض').catch(() => {});
                }
              }}>
              اعتماد وإرسال للمريض
            </Button>
          )}
          {r?.submittedAt && !can.approve && !can.returnReport && <Alert severity="info" sx={{ py: 0 }}>بانتظار اعتماد مدير المركز.</Alert>}
          {r?.submittedAt && can.returnReport && !can.approve && <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>سياسة المركز: يعتمد التقرير طبيب غير كاتبه.</Typography>}
        </Stack>
      </Stack>
      <ReasonDialog open={returnOpen} title="إعادة التقرير للتصحيح" label="ما الذي يحتاج تعديل؟" required confirmText="إعادة" onClose={() => setReturnOpen(false)}
        onSubmit={(note) => run(() => api.post(`/radiology-orders/${o.id}/report/return`, { note }), 'أُعيد التقرير لكاتبه')} />
    </Section>
  );
}

function DicomPanel({ o, onDone }) {
  const { enqueueSnackbar } = useSnackbar();
  const [url, setUrl] = useState(o.pacsUrl || '');
  useEffect(() => setUrl(o.pacsUrl || ''), [o.pacsUrl]);
  const copy = (v) => navigator.clipboard?.writeText(v).then(() => enqueueSnackbar('تم النسخ', { variant: 'info' }));
  const row = (label, v) => (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 110 }}>{label}</Typography>
      <Typography variant="body2" dir="ltr" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>{v}</Typography>
      <IconButton size="small" aria-label={`نسخ ${label}`} onClick={() => copy(v)}><ContentCopy fontSize="small" /></IconButton>
    </Stack>
  );
  return (
    <Section title="DICOM / PACS">
      {o.accessionNumber ? (
        <Stack spacing={1}>
          {row('Accession', o.accessionNumber)}
          {row('Study UID', o.studyInstanceUid)}
          {o.can.editPacs ? (
            <Stack direction="row" spacing={1}>
              <TextField size="small" fullWidth label="رابط الدراسة على PACS / عارض الصور" value={url} onChange={(e) => setUrl(e.target.value)} inputProps={{ dir: 'ltr' }} />
              <Button variant="outlined" disabled={url === (o.pacsUrl || '')} onClick={async () => {
                try {
                  await api.patch(`/radiology-orders/${o.id}/pacs`, { pacsUrl: url || null });
                  enqueueSnackbar('تم الحفظ', { variant: 'success' });
                  onDone();
                } catch (e) {
                  enqueueSnackbar(errorMessage(e), { variant: 'error' });
                }
              }}>حفظ</Button>
            </Stack>
          ) : o.pacsUrl && <Button href={o.pacsUrl} target="_blank" rel="noopener noreferrer" startIcon={<OpenInNew />}>فتح على PACS</Button>}
          <Typography variant="caption" color="text.secondary">الأرقام تظهر في قائمة عمل الأجهزة (Modality Worklist) ليتم ربط الصور بنفس الحجز عند ربط PACS.</Typography>
        </Stack>
      ) : (
        <Typography color="text.secondary">يصدر رقم Accession وكود الدراسة تلقائياً عند تسجيل الحضور.</Typography>
      )}
    </Section>
  );
}

export default function RadOrderWork() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const { data: o, isLoading, error, refetch } = useRadOrder(id);
  const [payAnchor, setPayAnchor] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  useRealtime('radiology:order', (e) => e.id === id && qc.invalidateQueries({ queryKey: ['radiology-orders', id] }));
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={3} height={160} />;
  const refresh = () => qc.invalidateQueries({ queryKey: ['radiology-orders'] });
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
  const transition = async (s) => {
    if (s === 'NO_SHOW' && !(await confirm({ title: 'تسجيل عدم حضور؟', body: 'سيُغلق الحجز ويصل للمريض إشعار.', danger: true, confirmText: 'لم يحضر' }))) return;
    act(() => api.post(`/radiology-orders/${id}/status`, { status: s }), RAD_STATUS[s].label).catch(() => {});
  };
  const showEditor = o.status === 'REPORTING' || !!o.report;
  const actions = [
    ...o.can.transitions.map((s) => (
      <Button key={s} variant={s === 'NO_SHOW' ? 'text' : 'contained'} color={s === 'NO_SHOW' ? 'error' : 'primary'} disabled={busy} onClick={() => transition(s)}>{RAD_NEXT_LABEL[s] || RAD_STATUS[s].label}</Button>
    )),
    o.can.recordPayment && <Button key="pay" variant="outlined" startIcon={<PaymentsOutlined />} disabled={busy} onClick={(e) => setPayAnchor(e.currentTarget)}>تسجيل الدفع</Button>,
    o.can.previewReport && <Button key="draft" startIcon={<PictureAsPdfOutlined />} onClick={() => downloadFile(`/radiology-orders/${id}/report.pdf`, `draft-${o.code}.pdf`).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>معاينة التقرير</Button>,
    o.can.downloadReport && <Button key="pdf" startIcon={<PictureAsPdfOutlined />} onClick={() => downloadRadReport(o).catch((e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }))}>التقرير PDF</Button>,
    o.can.chat && <ChatButton key="chat" payload={{ type: 'PATIENT_PROVIDER', providerId: o.center.providerId, patientId: o.patient.id }} label="مراسلة المريض" />,
    o.can.cancel && <Button key="cancel" color="error" onClick={() => setCancelOpen(true)}>إلغاء الحجز</Button>,
  ].filter(Boolean);
  return (
    <>
      <Button component={RouterLink} to="/provider/bookings" startIcon={<ArrowForward />} sx={{ mb: 1 }}>الحجوزات</Button>
      <PageHeader title={o.service.name} subtitle={`${o.patient.fullName} • ${o.branch?.name} • ${o.code}`} actions={actions} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <RadStatusChip value={o.status} size="medium" />
        <Chip size="small" variant="outlined" label={o.modalityLabel} />
        <Chip size="small" variant="outlined" color={o.paymentStatus === 'PAID' ? 'success' : 'default'} label={o.paymentStatus === 'PAID' ? `مدفوع • ${PAYMENT_METHOD[o.paymentMethod] || ''}` : 'لم يُدفع'} />
        {o.cancelReason && <Typography color="text.secondary">السبب: {o.cancelReason}</Typography>}
      </Stack>
      <Grid container spacing={2}>
        <Grid xs={12} lg={8}>
          <Stack spacing={2}>
            {showEditor ? <ReportEditor o={o} onDone={refresh} /> : !['CANCELLED', 'NO_SHOW'].includes(o.status) && (
              <Alert severity="info">كتابة التقرير تبدأ بعد تسجيل «انتهاء الفحص».</Alert>
            )}
            {(o.can.attachImages || o.images.length > 0) && (
              <Section title={`الصور والمرفقات (${o.images.length})`}>
                <ImageGallery images={o.images} onRemove={o.can.attachImages ? (img) => act(() => api.delete(`/radiology-orders/${id}/files/${img.id}`), 'تم الحذف').catch(() => {}) : undefined} />
                {o.can.attachImages && (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: o.images.length ? 2 : 0 }}>
                    <TextField size="small" label="وصف الصورة (اختياري)" value={caption} onChange={(e) => setCaption(e.target.value)} sx={{ flex: 1 }} />
                    <FileUploadButton purpose="RADIOLOGY_IMAGE" maxMb={15} label="إرفاق صورة / PDF" onUploaded={(f) => act(() => api.post(`/radiology-orders/${id}/files`, { fileId: f.id, caption: caption || undefined }), 'تم إرفاق الملف').then(() => setCaption('')).catch(() => {})} />
                  </Stack>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>أهم الصور (Key images) تظهر للمريض بعد الاعتماد وأول 4 منها تُطبع في التقرير. ملفات DICOM الكاملة مكانها PACS.</Typography>
              </Section>
            )}
          </Stack>
        </Grid>
        <Grid xs={12} lg={4}>
          <Stack spacing={2}>
            <Section title="المريض">
              <Typography sx={{ fontWeight: 700 }}>{o.patient.fullName}</Typography>
              <Typography variant="body2" color="text.secondary">{GENDER[o.patient.gender] || '—'} • {o.patient.ageYears != null ? `${o.patient.ageYears} سنة` : 'السن غير مسجل'}</Typography>
              <Typography variant="body2" dir="ltr" sx={{ textAlign: 'right' }}>{o.patient.phone}</Typography>
              {o.contactPhone && <Typography variant="body2">رقم التواصل: <span dir="ltr">{o.contactPhone}</span></Typography>}
              {o.referralFileId ? <Box sx={{ mt: 1 }}><ProtectedFile fileId={o.referralFileId} label="خطاب التحويل" /></Box> : <Typography variant="caption" color="text.secondary">بدون خطاب تحويل</Typography>}
            </Section>
            <Section title="الموعد">
              <Typography sx={{ fontWeight: 600 }}>{fmtDate(o.scheduledAt)}</Typography>
              <Typography>{fmtTime(o.scheduledAt)} — {fmtTime(o.endAt)}</Typography>
              <Typography variant="body2" color="text.secondary">{o.branch?.name}</Typography>
              <Divider sx={{ my: 1 }} />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 700 }}>السعر</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoney(o.price)}</Typography></Stack>
            </Section>
            <DicomPanel o={o} onDone={refresh} />
            <Section title="سجل الحجز"><HistoryList history={o.history} labels={RAD_STATUS} /></Section>
          </Stack>
        </Grid>
      </Grid>
      <Menu anchorEl={payAnchor} open={!!payAnchor} onClose={() => setPayAnchor(null)}>
        {Object.entries(PAYMENT_METHOD).map(([k, v]) => (
          <MenuItem key={k} onClick={() => { setPayAnchor(null); act(() => api.post(`/radiology-orders/${id}/payment`, { paymentMethod: k }), `تم تسجيل الدفع (${v})`).catch(() => {}); }}>
            <ListItemText primary={v} secondary={fmtMoney(o.price)} />
          </MenuItem>
        ))}
      </Menu>
      <ReasonDialog open={cancelOpen} title="إلغاء الحجز" body="سيصل للمريض إشعار بالإلغاء والسبب." label="سبب الإلغاء" required confirmText="إلغاء الحجز" danger onClose={() => setCancelOpen(false)} onSubmit={(reason) => act(() => api.post(`/radiology-orders/${id}/cancel`, { reason }), 'تم إلغاء الحجز')} />
    </>
  );
}
