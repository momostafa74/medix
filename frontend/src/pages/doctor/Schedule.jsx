import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../../api/client';
import { ErrorState, ListSkeleton, PageHeader, Section, useConfirm } from '../../components/common';
import { DAYS, fmtDateTime, fmtHHmm, fmtShortDate, todayISO } from '../../utils/format';
import { APPOINTMENT_TYPE } from '../../utils/labels';
import { tokens } from '../../theme';

const EXC = { HOLIDAY: 'إجازة رسمية', VACATION: 'إجازة شخصية', CUSTOM_HOURS: 'مواعيد مختلفة' };
const newBlock = (day, branchId) => ({ key: Math.random(), dayOfWeek: day, start: '10:00', end: '14:00', slotDuration: 20, branchId: branchId || '', appointmentType: 'CLINIC', isActive: true, breaks: [] });

export default function SchedulePage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['schedule'], queryFn: () => api.get('/doctors/me/schedule').then((r) => r.data) });
  const [blocks, setBlocks] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [excOpen, setExcOpen] = useState(false);
  const [conflicts, setConflicts] = useState(null);

  useEffect(() => {
    if (data) {
      setBlocks(data.blocks.map((b) => ({ ...b, key: b.id, branchId: b.branchId || '' })));
      setDirty(false);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.put('/doctors/me/schedule', {
        blocks: blocks.map(({ dayOfWeek, start, end, slotDuration, branchId, appointmentType, isActive, breaks }) => ({
          dayOfWeek, start, end, slotDuration: Number(slotDuration), branchId: branchId || null, appointmentType, isActive,
          breaks: breaks.map(({ start: s, end: e, label }) => ({ start: s, end: e, label: label || undefined })),
        })),
      }),
    onSuccess: () => {
      enqueueSnackbar('تم حفظ الجدول — المواعيد المتاحة تحدثت فوراً', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });

  const update = (key, patch) => { setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b))); setDirty(true); };
  const remove = (key) => { setBlocks((bs) => bs.filter((b) => b.key !== key)); setDirty(true); };
  const add = (day) => { setBlocks((bs) => [...bs, newBlock(day, data?.branches[0]?.id)]); setDirty(true); };

  const delExc = async (e) => {
    if (!(await confirm({ title: 'حذف هذا الاستثناء؟', body: 'ستعود مواعيدك الأسبوعية العادية لهذه الأيام.', confirmText: 'حذف', danger: true }))) return;
    await api.delete(`/doctors/me/exceptions/${e.id}`);
    qc.invalidateQueries({ queryKey: ['schedule'] });
    qc.invalidateQueries({ queryKey: ['availability'] });
  };
  const delBlock = async (b) => {
    await api.delete(`/doctors/me/slot-blocks/${b.id}`);
    qc.invalidateQueries({ queryKey: ['schedule'] });
  };

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) return <ListSkeleton rows={7} height={70} />;
  const types = ['CLINIC', data.settings.onlineAvailable && 'ONLINE', data.settings.homeVisitAvailable && 'HOME'].filter(Boolean);

  return (
    <>
      <PageHeader
        title="جدول المواعيد"
        subtitle={`المواعيد بتوقيت القاهرة. يمكن للمرضى الحجز حتى ${data.settings.bookingHorizonDays} يوماً مقدماً.`}
        actions={<Button variant="contained" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? 'جاري الحفظ…' : 'حفظ الجدول'}</Button>}
      />
      {!data.branches.length && <Alert severity="warning" sx={{ mb: 2 }}>أضف عيادة/فرعاً أولاً من صفحة «ملفي» قبل تحديد مواعيد الكشف في العيادة.</Alert>}
      {dirty && <Alert severity="info" sx={{ mb: 2 }}>لديك تغييرات غير محفوظة. الحجوزات الحالية لن تتأثر بتغيير الجدول.</Alert>}
      <Stack spacing={1.5}>
        {DAYS.map((name, day) => {
          const dayBlocks = blocks.filter((b) => b.dayOfWeek === day);
          return (
            <Section key={day} sx={{ p: 2 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="h6" sx={{ minWidth: 90 }}>{name}</Typography>
                {!dayBlocks.length && <Typography color="text.secondary" sx={{ flex: 1 }}>إجازة أسبوعية</Typography>}
                <Button size="small" startIcon={<AddIcon />} onClick={() => add(day)}>فترة عمل</Button>
              </Stack>
              <Stack spacing={1.5} sx={{ mt: dayBlocks.length ? 1.5 : 0 }}>
                {dayBlocks.map((b) => (
                  <Box key={b.key} sx={{ p: 1.5, borderRadius: '10px', bgcolor: b.isActive ? tokens.mint : tokens.paper, border: `1px solid ${tokens.line}` }}>
                    <Grid container spacing={1.5} alignItems="center">
                      <Grid xs={6} sm={2}><TextField type="time" label="من" InputLabelProps={{ shrink: true }} value={b.start} onChange={(e) => update(b.key, { start: e.target.value })} inputProps={{ step: 300 }} /></Grid>
                      <Grid xs={6} sm={2}><TextField type="time" label="إلى" InputLabelProps={{ shrink: true }} value={b.end === '24:00' ? '23:59' : b.end} onChange={(e) => update(b.key, { end: e.target.value })} inputProps={{ step: 300 }} /></Grid>
                      <Grid xs={6} sm={2}>
                        <TextField select label="مدة الكشف" value={b.slotDuration} onChange={(e) => update(b.key, { slotDuration: e.target.value })}>
                          {[10, 15, 20, 30, 45, 60, 90].map((m) => <MenuItem key={m} value={m}>{m} دقيقة</MenuItem>)}
                        </TextField>
                      </Grid>
                      <Grid xs={6} sm={2}>
                        <TextField select label="النوع" value={b.appointmentType} onChange={(e) => update(b.key, { appointmentType: e.target.value, branchId: e.target.value === 'CLINIC' ? b.branchId || data.branches[0]?.id || '' : '' })}>
                          {types.map((t) => <MenuItem key={t} value={t}>{APPOINTMENT_TYPE[t]}</MenuItem>)}
                        </TextField>
                      </Grid>
                      <Grid xs={12} sm={3}>
                        <TextField select label="العيادة" value={b.branchId} disabled={b.appointmentType !== 'CLINIC'} onChange={(e) => update(b.key, { branchId: e.target.value })}>
                          {data.branches.map((br) => <MenuItem key={br.id} value={br.id}>{br.name}</MenuItem>)}
                        </TextField>
                      </Grid>
                      <Grid xs={12} sm={1}>
                        <Stack direction="row" justifyContent="flex-end">
                          <Tooltip title={b.isActive ? 'إيقاف مؤقت' : 'تفعيل'}><Switch checked={b.isActive} onChange={(e) => update(b.key, { isActive: e.target.checked })} inputProps={{ 'aria-label': 'تفعيل الفترة' }} /></Tooltip>
                          <Tooltip title="حذف الفترة"><IconButton onClick={() => remove(b.key)} aria-label="حذف"><DeleteOutline /></IconButton></Tooltip>
                        </Stack>
                      </Grid>
                    </Grid>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                      <Typography variant="body2" color="text.secondary">الاستراحات:</Typography>
                      {b.breaks.map((br, i) => (
                        <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                          <TextField type="time" size="small" sx={{ width: 120 }} value={br.start} onChange={(e) => update(b.key, { breaks: b.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} inputProps={{ 'aria-label': 'بداية الاستراحة' }} />
                          <Typography>–</Typography>
                          <TextField type="time" size="small" sx={{ width: 120 }} value={br.end} onChange={(e) => update(b.key, { breaks: b.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} inputProps={{ 'aria-label': 'نهاية الاستراحة' }} />
                          <IconButton size="small" onClick={() => update(b.key, { breaks: b.breaks.filter((_, j) => j !== i) })} aria-label="حذف الاستراحة"><DeleteOutline fontSize="small" /></IconButton>
                        </Stack>
                      ))}
                      <Button size="small" onClick={() => update(b.key, { breaks: [...b.breaks, { start: '12:00', end: '12:30' }] })}>إضافة استراحة</Button>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Section>
          );
        })}
      </Stack>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid xs={12} md={7}>
          <Section title="الإجازات والأيام الاستثنائية" action={<Button size="small" startIcon={<AddIcon />} onClick={() => setExcOpen(true)}>إضافة</Button>}>
            {data.exceptions.length ? data.exceptions.map((e) => (
              <Stack key={e.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
                <Chip size="small" label={EXC[e.type]} color={e.type === 'CUSTOM_HOURS' ? 'default' : 'warning'} />
                <Typography sx={{ flex: 1 }}>
                  {fmtShortDate(e.startDate)}{e.endDate !== e.startDate && ` ← ${fmtShortDate(e.endDate)}`}
                  {e.type === 'CUSTOM_HOURS' && ` • ${fmtHHmm(e.start)} – ${fmtHHmm(e.end)}`}
                  {e.reason && <Typography component="span" color="text.secondary"> — {e.reason}</Typography>}
                </Typography>
                <IconButton size="small" onClick={() => delExc(e)} aria-label="حذف"><DeleteOutline fontSize="small" /></IconButton>
              </Stack>
            )) : <Typography color="text.secondary">لا توجد إجازات قادمة.</Typography>}
          </Section>
        </Grid>
        <Grid xs={12} md={5}>
          <Section title="مواعيد مغلقة يدوياً">
            {data.slotBlocks.length ? data.slotBlocks.map((b) => (
              <Stack key={b.id} direction="row" alignItems="center" sx={{ py: 0.5 }}>
                <Typography sx={{ flex: 1 }}>{fmtDateTime(b.startAt)} {b.reason && `— ${b.reason}`}</Typography>
                <IconButton size="small" onClick={() => delBlock(b)} aria-label="إعادة فتح"><DeleteOutline fontSize="small" /></IconButton>
              </Stack>
            )) : <Typography color="text.secondary">لا توجد مواعيد مغلقة.</Typography>}
          </Section>
        </Grid>
      </Grid>
      {excOpen && <ExceptionDialog branches={data.branches} onClose={() => setExcOpen(false)} onSaved={(res) => { qc.invalidateQueries({ queryKey: ['schedule'] }); qc.invalidateQueries({ queryKey: ['availability'] }); if (res.conflicts.length) setConflicts(res.conflicts); }} />}
      <Dialog open={!!conflicts} onClose={() => setConflicts(null)} maxWidth="sm" fullWidth>
        <DialogTitle>يوجد حجوزات في هذه الفترة</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1 }}>هذه الحجوزات لم يتم إلغاؤها تلقائياً. ألغِها أو غيّر موعدها من صفحة المواعيد وسيصل إشعار للمريض:</Typography>
          {conflicts?.map((c) => <Typography key={c.id}>• {fmtDateTime(c.startAt)} — {c.patientName} (<span dir="ltr">{c.code}</span>)</Typography>)}
        </DialogContent>
        <DialogActions><Button onClick={() => setConflicts(null)}>حسناً</Button></DialogActions>
      </Dialog>
    </>
  );
}

function ExceptionDialog({ branches, onClose, onSaved }) {
  const { enqueueSnackbar } = useSnackbar();
  const [f, setF] = useState({ type: 'VACATION', startDate: todayISO(), endDate: todayISO(), start: '10:00', end: '14:00', branchId: branches[0]?.id || '', reason: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { type: f.type, startDate: f.startDate, endDate: f.endDate, reason: f.reason || undefined, ...(f.type === 'CUSTOM_HOURS' ? { start: f.start, end: f.end, branchId: f.branchId || undefined } : {}) };
      const { data } = await api.post('/doctors/me/exceptions', body);
      onSaved(data);
      onClose();
    } catch (e) {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>إضافة إجازة أو مواعيد استثنائية</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="النوع" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {Object.entries(EXC).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
          <Stack direction="row" spacing={1}>
            <TextField type="date" label="من" InputLabelProps={{ shrink: true }} value={f.startDate} inputProps={{ min: todayISO() }} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} />
            <TextField type="date" label="إلى" InputLabelProps={{ shrink: true }} value={f.endDate} inputProps={{ min: f.startDate }} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Stack>
          {f.type === 'CUSTOM_HOURS' && (
            <>
              <Stack direction="row" spacing={1}>
                <TextField type="time" label="من الساعة" InputLabelProps={{ shrink: true }} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
                <TextField type="time" label="إلى الساعة" InputLabelProps={{ shrink: true }} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
              </Stack>
              <TextField select label="العيادة" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                {branches.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
              </TextField>
            </>
          )}
          <TextField label="السبب (اختياري)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={save} disabled={busy}>حفظ</Button>
      </DialogActions>
    </Dialog>
  );
}
