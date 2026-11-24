import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, fileUrl } from '../api/client';
import { Section, StatusChip, useConfirm } from './common';
import FileUploadButton from './FileUploadButton';
import LocationSelect from './LocationSelect';
import ProtectedFile from './ProtectedFile';
import { fmtMoney, fmtShortDate } from '../utils/format';
import { PROVIDER_DOC_TYPE, VERIFICATION } from '../utils/labels';
import { tokens } from '../theme';

export function useMyProvider() {
  return useQuery({ queryKey: ['providers', 'mine'], queryFn: () => api.get('/providers/mine').then((r) => r.data[0] || null) });
}

export function VerificationBanner({ provider }) {
  if (!provider || provider.verificationStatus === 'APPROVED') return null;
  const docs = provider.documents?.length || 0;
  const msg = {
    PENDING: docs ? 'حسابك قيد المراجعة. سيظهر ملفك للمرضى فور الاعتماد.' : 'ارفع صورة الترخيص وبطاقة الرقم القومي من قسم "مستندات التحقق" حتى نتمكن من مراجعة حسابك.',
    REJECTED: `لم يتم اعتماد الحساب${provider.verificationNote ? `: ${provider.verificationNote}` : ''}. حدّث بياناتك ومستنداتك وتواصل مع الدعم.`,
    SUSPENDED: `تم إيقاف ظهور حسابك مؤقتاً${provider.verificationNote ? `: ${provider.verificationNote}` : ''}.`,
  }[provider.verificationStatus];
  return (
    <Alert severity={provider.verificationStatus === 'PENDING' ? 'warning' : 'error'} sx={{ borderRadius: 0 }}>
      {msg}
    </Alert>
  );
}

export function ProviderInfoForm({ provider }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { register, handleSubmit, control, reset, formState } = useForm();
  useEffect(() => {
    reset({
      nameAr: provider.nameAr,
      nameEn: provider.nameEn || '',
      description: provider.description || '',
      phone: provider.phone || '',
      whatsappNumber: provider.whatsappNumber || '',
      email: provider.email || '',
      website: provider.website || '',
      homeServiceAvailable: provider.homeServiceAvailable,
    });
  }, [provider, reset]);
  const save = async (v) => {
    try {
      const body = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== '' || k === 'description'));
      await api.patch(`/providers/${provider.id}`, body);
      qc.invalidateQueries({ queryKey: ['providers', 'mine'] });
      enqueueSnackbar('تم الحفظ', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const setLogo = async (f) => {
    await api.patch(`/providers/${provider.id}`, { logoFileId: f.id });
    qc.invalidateQueries({ queryKey: ['providers', 'mine'] });
  };
  const isDoctor = provider.type === 'DOCTOR';
  return (
    <Section title="البيانات العامة" action={<StatusChip value={provider.verificationStatus} map={VERIFICATION} />}>
      <Stack component="form" spacing={2} onSubmit={handleSubmit(save)}>
        {!isDoctor && (
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar variant="rounded" src={fileUrl(provider.logoFileId) || undefined} sx={{ width: 64, height: 64, bgcolor: tokens.mint, color: tokens.petrol }}>{provider.nameAr[0]}</Avatar>
            <FileUploadButton purpose="PROVIDER_LOGO" accept="image/jpeg,image/png,image/webp" maxMb={3} label="تغيير الشعار" onUploaded={setLogo} size="small" />
          </Stack>
        )}
        <Grid container spacing={2}>
          {!isDoctor && (
            <>
              <Grid xs={12} sm={6}><TextField label="الاسم بالعربية" {...register('nameAr', { required: true })} /></Grid>
              <Grid xs={12} sm={6}><TextField label="الاسم بالإنجليزية" {...register('nameEn')} /></Grid>
              <Grid xs={12}><TextField label="الوصف" multiline minRows={3} {...register('description')} /></Grid>
            </>
          )}
          <Grid xs={12} sm={6}><TextField label="هاتف الحجز" inputProps={{ dir: 'ltr' }} {...register('phone')} /></Grid>
          <Grid xs={12} sm={6}><TextField label="رقم واتساب للحجز" inputProps={{ dir: 'ltr' }} helperText="يظهر زر «احجز عبر واتساب» للمرضى" {...register('whatsappNumber')} /></Grid>
          <Grid xs={12} sm={6}><TextField label="البريد" type="email" inputProps={{ dir: 'ltr' }} {...register('email')} /></Grid>
          <Grid xs={12} sm={6}><TextField label="الموقع الإلكتروني" placeholder="https://" inputProps={{ dir: 'ltr' }} {...register('website')} /></Grid>
        </Grid>
        {!isDoctor && <Controller name="homeServiceAvailable" control={control} render={({ field }) => <FormControlLabel control={<Switch checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="نقدم خدمة منزلية" />} />}
        <Box><Button type="submit" variant="contained" disabled={formState.isSubmitting}>حفظ</Button></Box>
      </Stack>
    </Section>
  );
}

export function BranchesManager({ provider }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [edit, setEdit] = useState(null);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['providers', 'mine'] }); qc.invalidateQueries({ queryKey: ['schedule'] }); };
  const del = async (b) => {
    if (!(await confirm({ title: `حذف ${b.name}؟`, body: 'إذا كان للفرع حجوزات سابقة سيتم إيقافه بدلاً من حذفه.', confirmText: 'حذف', danger: true }))) return;
    try {
      const { data } = await api.delete(`/providers/${provider.id}/branches/${b.id}`);
      enqueueSnackbar(data.deleted ? 'تم حذف الفرع' : 'تم إيقاف الفرع لوجود حجوزات مرتبطة به', { variant: 'success' });
      invalidate();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Section title={provider.type === 'DOCTOR' ? 'العيادات' : 'الفروع'} action={<Button size="small" startIcon={<AddIcon />} onClick={() => setEdit({})}>إضافة</Button>}>
      {provider.branches?.length ? provider.branches.map((b) => (
        <Stack key={b.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.75, opacity: b.isActive ? 1 : 0.55 }}>
          <Box sx={{ flex: 1 }}>
            <Typography component="div" sx={{ fontWeight: 600 }}>{b.name} {!b.isActive && <Chip size="small" label="موقوف" />}</Typography>
            <Typography variant="body2" color="text.secondary">{b.address}{b.phone && <> • <span dir="ltr">{b.phone}</span></>}</Typography>
          </Box>
          <IconButton size="small" onClick={() => setEdit(b)} aria-label="تعديل"><EditOutlined fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => del(b)} aria-label="حذف"><DeleteOutline fontSize="small" /></IconButton>
        </Stack>
      )) : <Typography color="text.secondary">لا توجد فروع. أضف عنواناً ليظهر للمرضى.</Typography>}
      {edit && <BranchDialog provider={provider} branch={edit} onClose={() => setEdit(null)} onSaved={invalidate} />}
    </Section>
  );
}

function BranchDialog({ provider, branch, onClose, onSaved }) {
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState({ name: branch.name || '', address: branch.address || '', phone: branch.phone || '', isActive: branch.isActive ?? true, hours: branch.workingHours ? Object.values(branch.workingHours).join(' ') : '' });
  const [loc, setLoc] = useState({ cityId: branch.cityId || undefined, areaId: branch.areaId || undefined });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name, address: f.address, phone: f.phone || undefined, cityId: loc.cityId || null, areaId: loc.areaId || null, isActive: f.isActive, workingHours: f.hours ? { all: f.hours } : null };
      if (branch.id) await api.patch(`/providers/${provider.id}/branches/${branch.id}`, body);
      else await api.post(`/providers/${provider.id}/branches`, body);
      onSaved();
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{branch.id ? 'تعديل' : 'إضافة'} {provider.type === 'DOCTOR' ? 'عيادة' : 'فرع'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="الاسم" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="العنوان بالتفصيل" required value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <LocationSelect value={loc} onChange={setLoc} />
          <TextField label="الهاتف" inputProps={{ dir: 'ltr' }} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          {provider.type !== 'DOCTOR' && <TextField label="مواعيد العمل" placeholder="يومياً 9 ص – 11 م" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />}
          <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="الفرع يعمل" />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={save} disabled={busy || f.name.length < 2 || f.address.length < 3}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}

export function ServicesManager({ provider }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const [edit, setEdit] = useState(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['providers', 'mine'] });
  const save = useMutation({
    mutationFn: (s) => (s.id ? api.patch(`/providers/${provider.id}/services/${s.id}`, s.body) : api.post(`/providers/${provider.id}/services`, s.body)),
    onSuccess: () => { invalidate(); setEdit(null); },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  const del = async (s) => {
    if (!(await confirm({ title: `حذف "${s.name}"؟`, confirmText: 'حذف', danger: true }))) return;
    await api.delete(`/providers/${provider.id}/services/${s.id}`);
    invalidate();
  };
  return (
    <Section title="الخدمات والأسعار" action={<Button size="small" startIcon={<AddIcon />} onClick={() => setEdit({ name: '', price: '', durationMinutes: '' })}>إضافة</Button>}>
      {provider.services?.length ? provider.services.map((s) => (
        <Stack key={s.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
          <Typography sx={{ flex: 1 }}>{s.name}{s.durationMinutes && <Typography component="span" variant="body2" color="text.secondary"> • {s.durationMinutes} دقيقة</Typography>}</Typography>
          <Typography sx={{ fontWeight: 600 }}>{fmtMoney(s.price)}</Typography>
          <IconButton size="small" onClick={() => setEdit(s)} aria-label="تعديل"><EditOutlined fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => del(s)} aria-label="حذف"><DeleteOutline fontSize="small" /></IconButton>
        </Stack>
      )) : <Typography color="text.secondary">لا توجد خدمات مضافة.</Typography>}
      <Dialog open={!!edit} onClose={() => setEdit(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{edit?.id ? 'تعديل خدمة' : 'خدمة جديدة'}</DialogTitle>
        {edit && (
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="اسم الخدمة" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              <TextField label="السعر (ج.م)" type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} />
              <TextField label="المدة بالدقائق (اختياري)" type="number" value={edit.durationMinutes ?? ''} onChange={(e) => setEdit({ ...edit, durationMinutes: e.target.value })} />
            </Stack>
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEdit(null)}>إلغاء</Button>
          <Button variant="contained" disabled={!edit?.name || edit?.price === '' || save.isPending} onClick={() => save.mutate({ id: edit.id, body: { name: edit.name, price: Number(edit.price), ...(edit.durationMinutes ? { durationMinutes: Number(edit.durationMinutes) } : {}) } })}>حفظ</Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

export function DocumentsManager({ provider }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [type, setType] = useState('LICENSE');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['providers', 'mine'] });
  const attach = async (f) => {
    try {
      await api.post(`/providers/${provider.id}/documents`, { fileId: f.id, type });
      enqueueSnackbar('تم رفع المستند وسيتم مراجعته', { variant: 'success' });
      invalidate();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  const del = async (d) => {
    try {
      await api.delete(`/providers/${provider.id}/documents/${d.id}`);
      invalidate();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    }
  };
  return (
    <Section title="مستندات التحقق">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>تراها إدارة المنصة فقط ولا تظهر للمرضى.</Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <TextField select size="small" value={type} onChange={(e) => setType(e.target.value)} sx={{ maxWidth: 220 }} inputProps={{ 'aria-label': 'نوع المستند' }}>
          {Object.entries(PROVIDER_DOC_TYPE).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
        </TextField>
        <FileUploadButton purpose="PROVIDER_DOCUMENT" label="رفع" onUploaded={attach} />
      </Stack>
      {provider.documents?.map((d) => (
        <Stack key={d.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
          <Typography sx={{ flex: 1 }}>{PROVIDER_DOC_TYPE[d.type] || d.type} <Typography component="span" variant="caption" color="text.secondary">• {fmtShortDate(d.createdAt)}</Typography></Typography>
          {d.verifiedAt ? <Chip size="small" color="success" label="تم التحقق" /> : <Chip size="small" label="قيد المراجعة" />}
          <ProtectedFile fileId={d.fileId} label="عرض" />
          {!d.verifiedAt && (
            <Tooltip title="حذف"><IconButton size="small" onClick={() => del(d)} aria-label="حذف"><DeleteOutline fontSize="small" /></IconButton></Tooltip>
          )}
        </Stack>
      ))}
    </Section>
  );
}
