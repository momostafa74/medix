import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { ErrorState, ListSkeleton, PageHeader, Section, useConfirm } from '../../components/common';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { LabResultsHistory } from '../../components/lab/LabUi';
import { RadiologyReportsHistory } from '../../components/radiology/RadUi';
import { PrescriptionsHistory } from '../../components/pharmacy/PhUi';
import FileUploadButton from '../../components/FileUploadButton';
import ProtectedFile from '../../components/ProtectedFile';
import { fmtDate, fmtShortDate } from '../../utils/format';
import { DOC_TYPE, SEVERITY } from '../../utils/labels';

const SECTIONS = {
  allergies: {
    title: 'الحساسية',
    empty: 'لا توجد حساسية مسجلة',
    fields: [
      { name: 'allergen', label: 'مسبب الحساسية', required: true },
      { name: 'severity', label: 'الشدة', select: SEVERITY },
      { name: 'reaction', label: 'رد الفعل' },
    ],
    line: (x) => (
      <>
        <b>{x.allergen}</b> {x.severity && <Chip size="small" color={x.severity === 'SEVERE' ? 'error' : 'default'} label={SEVERITY[x.severity]} />} {x.reaction}
      </>
    ),
  },
  conditions: {
    title: 'الأمراض المزمنة والتشخيصات',
    empty: 'لا يوجد',
    fields: [
      { name: 'name', label: 'المرض/التشخيص', required: true },
      { name: 'diagnosedAt', label: 'تاريخ التشخيص', type: 'date' },
      { name: 'isChronic', label: 'مرض مزمن', checkbox: true },
      { name: 'notes', label: 'ملاحظات' },
    ],
    line: (x) => (
      <>
        <b>{x.name}</b> {x.isChronic && <Chip size="small" label="مزمن" />} {x.diagnosedAt && `— ${fmtShortDate(x.diagnosedAt)}`}
      </>
    ),
  },
  medications: {
    title: 'الأدوية',
    empty: 'لا توجد أدوية مسجلة',
    fields: [
      { name: 'name', label: 'اسم الدواء', required: true },
      { name: 'dosage', label: 'الجرعة' },
      { name: 'frequency', label: 'عدد المرات' },
      { name: 'startedAt', label: 'بداية الاستخدام', type: 'date' },
      { name: 'isCurrent', label: 'أستخدمه حالياً', checkbox: true },
    ],
    line: (x) => (
      <>
        <b>{x.name}</b> {[x.dosage, x.frequency].filter(Boolean).join(' • ')} {!x.isCurrent && <Chip size="small" label="متوقف" />}
      </>
    ),
  },
  surgeries: {
    title: 'العمليات السابقة',
    empty: 'لا توجد عمليات',
    fields: [
      { name: 'name', label: 'العملية', required: true },
      { name: 'performedAt', label: 'التاريخ', type: 'date' },
      { name: 'hospital', label: 'المستشفى' },
      { name: 'notes', label: 'ملاحظات' },
    ],
    line: (x) => (
      <>
        <b>{x.name}</b> {x.performedAt && `— ${fmtShortDate(x.performedAt)}`} {x.hospital && `• ${x.hospital}`}
      </>
    ),
  },
};

export default function MedicalRecordPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [edit, setEdit] = useState(null); // { section, item? }
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['medical-record', 'me'], queryFn: () => api.get('/patients/me/medical-record').then((r) => r.data) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['medical-record', 'me'] });
  const del = async (section, item) => {
    if (!(await confirm({ title: 'حذف هذا العنصر؟', confirmText: 'حذف', danger: true }))) return;
    try {
      await api.delete(`/patients/me/medical-record/${section}/${item.id}`);
      invalidate();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={6} height={90} />;
  const r = data.record;
  return (
    <>
      <PageHeader title="سجلي الطبي" subtitle="هذه البيانات يراها فقط الأطباء ومقدمو الخدمة الذين تحجز معهم أو تمنحهم صلاحية، وكل اطلاع عليها يُسجّل." />
      <Grid container spacing={2}>
        {Object.entries(SECTIONS).map(([key, cfg]) => (
          <Grid xs={12} md={6} key={key}>
            <Section title={cfg.title} action={<Button size="small" onClick={() => setEdit({ section: key })}>إضافة</Button>}>
              {r[key]?.length ? (
                <Stack spacing={0.5}>
                  {r[key].map((x) => (
                    <Stack key={x.id} direction="row" alignItems="center" spacing={1}>
                      <Typography component="div" sx={{ flex: 1 }}>{cfg.line(x)}</Typography>
                      <Tooltip title="تعديل"><IconButton size="small" onClick={() => setEdit({ section: key, item: x })} aria-label="تعديل"><EditOutlined fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="حذف"><IconButton size="small" onClick={() => del(key, x)} aria-label="حذف"><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Typography color="text.secondary">{cfg.empty}</Typography>
              )}
            </Section>
          </Grid>
        ))}
        <Grid xs={12} md={6}>
          <Documents docs={data.documents} onChange={invalidate} />
        </Grid>
        <Grid xs={12} md={6}>
          <AccessGrants />
        </Grid>
        <Grid xs={12}>
          <Section title="نتائج التحاليل" action={<Button size="small" component={RouterLink} to="/patient/lab-orders">كل التحاليل</Button>}>
            <LabResultsHistory patientId={user.patientId} />
          </Section>
        </Grid>
        <Grid xs={12}>
          <Section title="تقارير الأشعة" action={<Button size="small" component={RouterLink} to="/patient/radiology">كل الأشعة</Button>}>
            <RadiologyReportsHistory patientId={user.patientId} />
          </Section>
        </Grid>
        <Grid xs={12}>
          <Section title="الروشتات" action={<Button size="small" component={RouterLink} to="/patient/prescriptions">كل الروشتات</Button>}>
            <PrescriptionsHistory patientId={user.patientId} />
          </Section>
        </Grid>
        <Grid xs={12}>
          <Section title="الزيارات المكتملة">
            {data.visits.length ? (
              <>
                {data.visits.slice(0, showAll ? undefined : 8).map((v) => <Typography key={v.id}>{fmtDate(v.startAt)} — {v.provider} {v.specialty && `(${v.specialty})`}</Typography>)}
                {data.visits.length > 8 && <Button size="small" sx={{ mt: 1 }} onClick={() => setShowAll((x) => !x)}>{showAll ? 'عرض أقل' : `عرض كل الزيارات (${data.visits.length})`}</Button>}
              </>
            ) : <Typography color="text.secondary">لا توجد زيارات مكتملة بعد</Typography>}
          </Section>
        </Grid>
      </Grid>
      {edit && <ItemDialog edit={edit} onClose={() => setEdit(null)} onSaved={invalidate} />}
    </>
  );
}

function ItemDialog({ edit, onClose, onSaved }) {
  const cfg = SECTIONS[edit.section];
  const { enqueueSnackbar } = useSnackbar();
  const defaults = Object.fromEntries(cfg.fields.map((f) => [f.name, edit.item?.[f.name] ?? (f.checkbox ? true : '')]));
  const { register, handleSubmit, control, formState } = useForm({ defaultValues: defaults });
  const save = async (v) => {
    const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== null));
    try {
      if (edit.item) await api.patch(`/patients/me/medical-record/${edit.section}/${edit.item.id}`, body);
      else await api.post(`/patients/me/medical-record/${edit.section}`, body);
      onSaved();
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{edit.item ? 'تعديل' : 'إضافة'} — {cfg.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }} component="form" id="mr-form" onSubmit={handleSubmit(save)}>
          {cfg.fields.map((f) =>
            f.checkbox ? (
              <Controller key={f.name} name={f.name} control={control} render={({ field }) => <FormControlLabel control={<Checkbox checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />} label={f.label} />} />
            ) : f.select ? (
              <Controller key={f.name} name={f.name} control={control} render={({ field }) => (
                <TextField select label={f.label} {...field}>
                  <MenuItem value="">—</MenuItem>
                  {Object.entries(f.select).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
                </TextField>
              )} />
            ) : (
              <TextField key={f.name} label={f.label} type={f.type || 'text'} required={f.required} InputLabelProps={f.type === 'date' ? { shrink: true } : undefined} {...register(f.name, { required: f.required })} />
            ),
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button type="submit" form="mr-form" variant="contained" disabled={formState.isSubmitting}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

function Documents({ docs, onChange }) {
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [pending, setPending] = useState(null);
  const [meta, setMeta] = useState({ title: '', type: 'REPORT', documentDate: '' });
  const attach = async () => {
    try {
      await api.post('/patients/me/documents', { fileId: pending.id, ...meta, documentDate: meta.documentDate || undefined });
      setPending(null);
      setMeta({ title: '', type: 'REPORT', documentDate: '' });
      onChange();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const remove = async (d) => {
    if (!(await confirm({ title: `حذف "${d.title}"؟`, confirmText: 'حذف', danger: true }))) return;
    await api.delete(`/patients/me/documents/${d.id}`);
    onChange();
  };
  return (
    <Section title="المستندات الطبية" action={<FileUploadButton size="small" purpose="MEDICAL_DOCUMENT" label="رفع مستند" onUploaded={(f) => { setPending(f); setMeta((m) => ({ ...m, title: f.originalName.replace(/\.[^.]+$/, '') })); }} />}>
      {docs.length ? docs.map((d) => (
        <Stack key={d.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 600 }}>{d.title}</Typography>
            <Typography variant="caption" color="text.secondary">{DOC_TYPE[d.type]} • {fmtShortDate(d.documentDate || d.createdAt)}</Typography>
          </Box>
          {d.file && <ProtectedFile fileId={d.file.id} label="عرض" />}
          <IconButton size="small" onClick={() => remove(d)} aria-label="حذف"><DeleteOutline fontSize="small" /></IconButton>
        </Stack>
      )) : <Typography color="text.secondary">ارفع التقارير والتحاليل والروشتات القديمة (PDF أو صور حتى 10 ميجا).</Typography>}
      <Dialog open={!!pending} onClose={() => setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle>بيانات المستند</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="العنوان" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
            <TextField select label="النوع" value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value })}>
              {Object.entries(DOC_TYPE).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
            <TextField type="date" label="تاريخ المستند" InputLabelProps={{ shrink: true }} value={meta.documentDate} onChange={(e) => setMeta({ ...meta, documentDate: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPending(null)}>إلغاء</Button>
          <Button variant="contained" onClick={attach} disabled={meta.title.trim().length < 2}>حفظ المستند</Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

function AccessGrants() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['grants'], queryFn: () => api.get('/patients/me/access-grants').then((r) => r.data) });
  const revoke = useMutation({ mutationFn: (id) => api.delete(`/patients/me/access-grants/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['grants'] }) });
  return (
    <Section title="صلاحيات إضافية منحتها">
      <Alert severity="info" sx={{ mb: 1.5 }}>الأطباء الذين حجزت معهم يرون سجلك تلقائياً. هنا تظهر الصلاحيات التي منحتها يدوياً لجهات أخرى.</Alert>
      {data.length ? data.map((g) => (
        <Stack key={g.id} direction="row" alignItems="center" justifyContent="space-between">
          <Typography>{g.provider?.nameAr}</Typography>
          <Button size="small" color="error" onClick={() => revoke.mutate(g.id)}>سحب الصلاحية</Button>
        </Stack>
      )) : <Typography color="text.secondary">لا توجد صلاحيات إضافية</Typography>}
    </Section>
  );
}
