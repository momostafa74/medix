import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Rating, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { api, errorMessage } from '../api/client';
import SlotPicker from './SlotPicker';
import { fmtDate, fmtTime } from '../utils/format';

export function useInvalidateAppointments() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['availability'] });
  };
}

export function CancelDialog({ appointment, onClose }) {
  const [reason, setReason] = useState('');
  const invalidate = useInvalidateAppointments();
  const { enqueueSnackbar } = useSnackbar();
  const m = useMutation({
    mutationFn: () => api.patch(`/appointments/${appointment.id}/cancel`, { reason: reason || undefined }),
    onSuccess: () => {
      enqueueSnackbar('تم إلغاء الموعد', { variant: 'success' });
      invalidate();
      onClose();
    },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  return (
    <Dialog open={!!appointment} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>إلغاء الموعد</DialogTitle>
      <DialogContent>
        {appointment && (
          <Typography sx={{ mb: 2 }}>
            موعد {fmtDate(appointment.startAt)} الساعة {fmtTime(appointment.startAt)} سيتم إلغاؤه ويصبح متاحاً لغيرك.
          </Typography>
        )}
        <TextField label="سبب الإلغاء (اختياري)" multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>تراجع</Button>
        <Button variant="contained" color="error" onClick={() => m.mutate()} disabled={m.isPending}>
          إلغاء الموعد
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function RescheduleDialog({ appointment, onClose }) {
  const [slot, setSlot] = useState(null);
  const invalidate = useInvalidateAppointments();
  const { enqueueSnackbar } = useSnackbar();
  const m = useMutation({
    mutationFn: () => api.patch(`/appointments/${appointment.id}/reschedule`, { startAt: slot.startAt }),
    onSuccess: () => {
      enqueueSnackbar('تم تغيير الموعد', { variant: 'success' });
      invalidate();
      onClose();
    },
    onError: (e) => {
      enqueueSnackbar(errorMessage(e), { variant: 'error' });
      setSlot(null);
      invalidate();
    },
  });
  return (
    <Dialog open={!!appointment} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>تغيير موعد الحجز</DialogTitle>
      <DialogContent>
        {appointment && (
          <>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              الموعد الحالي: {fmtDate(appointment.startAt)} — {fmtTime(appointment.startAt)}
            </Typography>
            <SlotPicker doctorId={appointment.doctorId} type={appointment.type} value={slot} onChange={setSlot} />
            {slot && (
              <Alert severity="info" sx={{ mt: 2 }}>
                الموعد الجديد: {fmtDate(slot.startAt)} — {fmtTime(slot.startAt)}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>تراجع</Button>
        <Button variant="contained" disabled={!slot || m.isPending} onClick={() => m.mutate()}>
          تأكيد الموعد الجديد
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ReviewDialog({ appointment, onClose }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const invalidate = useInvalidateAppointments();
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const m = useMutation({
    mutationFn: () => api.post('/reviews', { appointmentId: appointment.id, rating, comment: comment || undefined }),
    onSuccess: () => {
      enqueueSnackbar('شكراً لتقييمك', { variant: 'success' });
      invalidate();
      qc.invalidateQueries({ queryKey: ['doctor'] });
      onClose();
    },
    onError: (e) => enqueueSnackbar(errorMessage(e), { variant: 'error' }),
  });
  return (
    <Dialog open={!!appointment} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>قيّم زيارتك</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary">{appointment?.provider?.nameAr}</Typography>
        <Box sx={{ my: 2 }}>
          <Rating size="large" value={rating} onChange={(_, v) => setRating(v || 1)} />
        </Box>
        <TextField label="تعليقك (اختياري)" multiline minRows={3} value={comment} onChange={(e) => setComment(e.target.value)} inputProps={{ maxLength: 1000 }} />
        <Typography variant="caption" color="text.secondary">
          يظهر اسمك الأول فقط مع التقييم.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>لاحقاً</Button>
        <Button variant="contained" onClick={() => m.mutate()} disabled={m.isPending}>
          إرسال التقييم
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function Field({ label, children }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.75 }}>
      <Typography color="text.secondary" sx={{ minWidth: 120 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1 }}>{children}</Box>
    </Stack>
  );
}
