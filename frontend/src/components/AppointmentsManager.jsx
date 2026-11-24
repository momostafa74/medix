import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import MoreVert from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import Close from '@mui/icons-material/Close';
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage, qs } from '../api/client';
import DataTable from './DataTable';
import ChatButton from './ChatButton';
import { StatusChip, useDebounced } from './common';
import { CancelDialog, Field, RescheduleDialog, useInvalidateAppointments } from './AppointmentDialogs';
import { fmtDateTime, fmtMoney, fmtShortDate, fmtTime } from '../utils/format';
import { APPOINTMENT_STATUS, APPOINTMENT_TYPE } from '../utils/labels';

/** Next allowed provider actions per status (mirrors the backend state machine). */
const ACTIONS = {
  PENDING: [{ to: 'CONFIRMED', label: 'تأكيد الموعد' }],
  CONFIRMED: [{ to: 'CHECKED_IN', label: 'تسجيل الحضور' }, { to: 'COMPLETED', label: 'إنهاء الكشف' }, { to: 'NO_SHOW', label: 'لم يحضر', pastOnly: true }],
  CHECKED_IN: [{ to: 'IN_PROGRESS', label: 'بدء الكشف' }, { to: 'COMPLETED', label: 'إنهاء الكشف' }],
  IN_PROGRESS: [{ to: 'COMPLETED', label: 'إنهاء الكشف' }],
};

const VIEWS = {
  today: { label: 'اليوم', q: { when: 'today', sortDir: 'asc' } },
  upcoming: { label: 'القادمة', q: { when: 'upcoming', status: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'], sortDir: 'asc' } },
  pending: { label: 'بانتظار التأكيد', q: { status: ['PENDING'], when: 'upcoming', sortDir: 'asc' } },
  past: { label: 'السابقة', q: { when: 'past', sortDir: 'desc' } },
  cancelled: { label: 'الملغاة', q: { status: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'], sortDir: 'desc' } },
};

export default function AppointmentsManager({ scope = 'provider', patientBase }) {
  const [view, setView] = useState('today');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [text, setText] = useState('');
  const search = useDebounced(text);
  const [menu, setMenu] = useState(null);
  const [detail, setDetail] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [resched, setResched] = useState(null);
  const invalidate = useInvalidateAppointments();
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', scope, view, page, pageSize, search],
    queryFn: () => api.get(`/appointments${qs({ scope, ...VIEWS[view].q, page, pageSize, search })}`).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const status = useMutation({
    mutationFn: ({ id, to }) => api.patch(`/appointments/${id}/status`, { status: to }),
    onSuccess: () => {
      enqueueSnackbar('تم تحديث الحالة', { variant: 'success' });
      invalidate();
    },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });

  const actionsFor = (a) => (ACTIONS[a.status] || []).filter((x) => !x.pastOnly || new Date(a.startAt) <= new Date());
  const columns = [
    { key: 'time', label: 'الموعد', render: (a) => (view === 'today' ? <b>{fmtTime(a.startAt)}</b> : fmtDateTime(a.startAt)) },
    {
      key: 'patient',
      label: 'المريض',
      render: (a) => (
        <Box>
          <Typography sx={{ fontWeight: 600 }}>{a.patient?.user?.fullName}</Typography>
          <Typography variant="caption" color="text.secondary" dir="ltr">{a.patient?.user?.phone}</Typography>
        </Box>
      ),
    },
    ...(scope === 'all' ? [{ key: 'provider', label: 'مقدم الخدمة', render: (a) => a.provider?.nameAr }] : []),
    { key: 'type', label: 'النوع', render: (a) => APPOINTMENT_TYPE[a.type] },
    { key: 'branch', label: 'الفرع', render: (a) => a.branch?.name || '—' },
    { key: 'price', label: 'السعر', render: (a) => fmtMoney(a.finalPrice) },
    { key: 'status', label: 'الحالة', render: (a) => <StatusChip value={a.status} map={APPOINTMENT_STATUS} /> },
    {
      key: 'actions',
      label: '',
      align: 'left',
      render: (a) => {
        const acts = actionsFor(a);
        return (
          <Stack direction="row" spacing={0.5} justifyContent="flex-end" onClick={(e) => e.stopPropagation()}>
            {acts[0] && (
              <Button size="small" variant="outlined" onClick={() => status.mutate({ id: a.id, to: acts[0].to })} disabled={status.isPending}>
                {acts[0].label}
              </Button>
            )}
            <IconButton size="small" aria-label="إجراءات" onClick={(e) => setMenu({ el: e.currentTarget, a })}>
              <MoreVert />
            </IconButton>
          </Stack>
        );
      },
    },
  ];

  return (
    <Card>
      <Box sx={{ px: 2, pt: 1 }}>
        <Tabs value={view} onChange={(_, v) => { setView(v); setPage(1); }} variant="scrollable">
          {Object.entries(VIEWS).map(([k, v]) => <Tab key={k} value={k} label={v.label} />)}
        </Tabs>
      </Box>
      <Box sx={{ p: 2 }}>
        <TextField placeholder="ابحث برقم الحجز أو اسم/موبايل المريض" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} sx={{ maxWidth: 420 }} inputProps={{ 'aria-label': 'بحث' }} />
      </Box>
      <DataTable
        columns={columns}
        rows={data?.items}
        loading={isLoading}
        total={data?.total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        onRowClick={(a) => setDetail(a.id)}
        empty={<Box sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">لا توجد مواعيد في هذا القسم</Typography></Box>}
      />
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {menu && actionsFor(menu.a).map((x) => (
          <MenuItem key={x.to} onClick={() => { status.mutate({ id: menu.a.id, to: x.to }); setMenu(null); }}>{x.label}</MenuItem>
        ))}
        {menu?.a.canReschedule && <MenuItem onClick={() => { setResched(menu.a); setMenu(null); }}>تغيير الموعد</MenuItem>}
        {menu?.a.canCancel && <MenuItem sx={{ color: 'error.main' }} onClick={() => { setCancel(menu.a); setMenu(null); }}>إلغاء الموعد</MenuItem>}
        <MenuItem onClick={() => { setDetail(menu.a.id); setMenu(null); }}>التفاصيل</MenuItem>
      </Menu>
      <AppointmentDrawer id={detail} onClose={() => setDetail(null)} patientBase={patientBase} canEditNotes={scope === 'provider'} />
      <CancelDialog appointment={cancel} onClose={() => setCancel(null)} />
      <RescheduleDialog appointment={resched} onClose={() => setResched(null)} />
    </Card>
  );
}

function AppointmentDrawer({ id, onClose, patientBase, canEditNotes }) {
  const { enqueueSnackbar } = useSnackbar();
  const invalidate = useInvalidateAppointments();
  const { data: a, refetch } = useQuery({ queryKey: ['appointments', 'one', id], queryFn: () => api.get(`/appointments/${id}`).then((r) => r.data), enabled: !!id });
  const [notes, setNotes] = useState(null);
  const saveNotes = useMutation({
    mutationFn: () => api.patch(`/appointments/${id}/doctor-notes`, { doctorNotes: notes ?? '' }),
    onSuccess: () => { enqueueSnackbar('تم حفظ الملاحظات', { variant: 'success' }); refetch(); invalidate(); },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  return (
    <Drawer anchor="left" open={!!id} onClose={() => { setNotes(null); onClose(); }} PaperProps={{ sx: { width: { xs: '100%', sm: 440 } } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2 }}>
        <Typography variant="h6">تفاصيل الموعد</Typography>
        <IconButton onClick={onClose} aria-label="إغلاق"><Close /></IconButton>
      </Stack>
      <Divider />
      {a && (
        <Box sx={{ p: 2 }}>
          <Field label="رقم الحجز"><span dir="ltr">{a.code}</span></Field>
          <Field label="الحالة"><StatusChip value={a.status} map={APPOINTMENT_STATUS} /></Field>
          <Field label="الموعد">{fmtDateTime(a.startAt)}</Field>
          <Field label="النوع">{APPOINTMENT_TYPE[a.type]}</Field>
          {a.branch && <Field label="الفرع">{a.branch.name}</Field>}
          {a.homeAddress && <Field label="عنوان الزيارة">{a.homeAddress}</Field>}
          <Field label="السعر">{fmtMoney(a.finalPrice)}</Field>
          <Field label="المريض">
            {patientBase ? <RouterLink to={`${patientBase}/${a.patientId}`}>{a.patient?.user?.fullName}</RouterLink> : a.patient?.user?.fullName}
            <Typography variant="body2" dir="ltr" sx={{ textAlign: 'right' }}>{a.patient?.user?.phone}</Typography>
          </Field>
          {canEditNotes && (
            <Box sx={{ my: 1 }}>
              <ChatButton size="small" payload={{ type: 'PATIENT_PROVIDER', patientId: a.patientId, providerId: a.providerId }} label="مراسلة المريض" />
            </Box>
          )}
          {a.notes && <Field label="ملاحظات المريض">{a.notes}</Field>}
          {a.cancelReason && <Field label="سبب الإلغاء">{a.cancelReason}</Field>}
          {canEditNotes && (
            <Box sx={{ mt: 2 }}>
              <TextField label="ملاحظات الطبيب (خاصة، لا يراها المريض)" multiline minRows={3} value={notes ?? a.doctorNotes ?? ''} onChange={(e) => setNotes(e.target.value)} />
              <Button sx={{ mt: 1 }} variant="contained" size="small" onClick={() => saveNotes.mutate()} disabled={notes === null || saveNotes.isPending}>حفظ الملاحظات</Button>
            </Box>
          )}
          <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>سجل الحالة</Typography>
          {a.history?.map((h) => (
            <Stack key={h.id} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
              <StatusChip value={h.toStatus} map={APPOINTMENT_STATUS} />
              <Typography variant="caption" color="text.secondary">{fmtShortDate(h.createdAt)} {fmtTime(h.createdAt)}</Typography>
            </Stack>
          ))}
        </Box>
      )}
    </Drawer>
  );
}
